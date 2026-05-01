import { format } from 'date-fns'
import { getEffectiveHabitStartTime } from './habitScheduling'

// A single occurrence of a habit on a given date, resolved to concrete
// hour-since-midnight bounds after applying meeting/session/habit-vs-habit
// conflict resolution.
export interface HabitPlacement {
  habitId: string
  dailyLogId?: string // log row that drove this occurrence, if any
  dateKey: string
  start: number // hours since midnight
  end: number
  duration: number // minutes
  isRescheduled: boolean
}

interface DayColumn {
  dateStr: string
  date: Date
}

/**
 * Compute the effective time windows each habit occupies on each day, after
 * applying these rules in order:
 *
 *  1. Habits that don't overlap any meeting or session on their day KEEP
 *     their original scheduled start time.
 *  2. Habits that DO overlap a meeting/session get pushed to the meeting (or
 *     session) end time.
 *  3. Habits that would now overlap another already-placed habit get pushed
 *     to the end of the overlapping habit. No extra buffer — back-to-back.
 *
 * Preserved habits are placed first so they anchor their original slots;
 * shuffled habits then cascade after them. This lets the caller (render
 * path and task scheduler) agree on one set of "effective" habit positions.
 */
export const resolveHabitPlacements = (
  habits: any[],
  meetings: any[],
  sessions: any[],
  dayColumns: DayColumn[]
): HabitPlacement[] => {
  interface Occurrence {
    habit: any
    log: any | null
    origStart: number
    origEnd: number
    duration: number
  }

  const candidatesByDate = new Map<string, Occurrence[]>()

  for (const habit of habits) {
    if (habit.habits_types?.scheduling_rule === 'non_calendar') continue

    for (const col of dayColumns) {
      const dateKey = col.dateStr

      const dailyLogs = (habit.habits_daily_logs || []).filter(
        (l: any) => l.log_date === dateKey
      )
      const unskipped = dailyLogs.filter((l: any) => !l.is_skipped)
      const hasSkipped = dailyLogs.some((l: any) => l.is_skipped)

      // Archived habits stop scheduling forward but stay on dates that
      // already have an unskipped log so past completions remain visible.
      if (habit.is_archived) {
        if (unskipped.length === 0) continue
      } else {
        if (habit.created_at) {
          const creationDate = new Date(habit.created_at).toLocaleDateString('en-CA')
          if (dateKey < creationDate) continue
        }

        // Weekly pattern filter — skipped unless an explicit daily log overrides.
        if (habit.weekly_days && habit.weekly_days.length > 0) {
          const dayName = col.date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
          const matchesPattern = habit.weekly_days.includes(dayName)
          const hasOverrideLog = unskipped.length > 0
          if (!matchesPattern && !hasOverrideLog) continue
        }

        if (hasSkipped && unskipped.length === 0) continue
      }

      const logsToRender: (any | null)[] = unskipped.length > 0 ? unskipped : [null]

      for (const log of logsToRender) {
        const effectiveStart = getEffectiveHabitStartTime(habit, dateKey, log)
        const duration = (log?.duration || habit.duration || 0) as number
        if (!effectiveStart || duration <= 0) continue
        const [h, m] = effectiveStart.split(':').map(Number)
        const origStart = h + m / 60
        const origEnd = origStart + duration / 60
        const list = candidatesByDate.get(dateKey) || []
        list.push({ habit, log, origStart, origEnd, duration })
        candidatesByDate.set(dateKey, list)
      }
    }
  }

  const result: HabitPlacement[] = []

  for (const [dateKey, occurrences] of candidatesByDate.entries()) {
    const dateMeetings = meetings.filter(
      m => format(new Date(m.start_time), 'yyyy-MM-dd') === dateKey
    )
    const dateSessions = sessions.filter(s => s.scheduled_date === dateKey)

    const findConflictingMeetingEnd = (start: number, end: number): number | null => {
      for (const m of dateMeetings) {
        const ms = new Date(m.start_time)
        const me = new Date(m.end_time)
        const msH = ms.getHours() + ms.getMinutes() / 60
        const meH = me.getHours() + me.getMinutes() / 60
        if (start < meH && end > msH) return meH
      }
      return null
    }

    const findConflictingSessionEnd = (start: number, end: number): number | null => {
      for (const s of dateSessions) {
        if (!s.actual_start_time) continue
        const timeOnly = String(s.actual_start_time).split(/[+-]/)[0]
        const [h, m] = timeOnly.split(':').map(Number)
        const ss = h + m / 60
        const se = ss + (s.scheduled_hours || 1)
        if (start < se && end > ss) return se
      }
      return null
    }

    type Entry = { occ: Occurrence; shuffleStart?: number }
    const preserved: Entry[] = []
    const shuffled: Entry[] = []
    for (const occ of occurrences) {
      const meetingEnd = findConflictingMeetingEnd(occ.origStart, occ.origEnd)
      const sessionEnd =
        meetingEnd === null ? findConflictingSessionEnd(occ.origStart, occ.origEnd) : null
      if (meetingEnd === null && sessionEnd === null) {
        preserved.push({ occ })
      } else {
        shuffled.push({ occ, shuffleStart: meetingEnd ?? sessionEnd! })
      }
    }

    preserved.sort((a, b) => a.occ.origStart - b.occ.origStart)
    shuffled.sort((a, b) => a.occ.origStart - b.occ.origStart)

    const placed: Array<{ start: number; end: number }> = []

    const placeAt = (candidateStart: number, duration: number) => {
      let start = candidateStart
      for (let guard = 0; guard < 50; guard++) {
        const end = start + duration / 60
        const conflict = placed.find(p => start < p.end && end > p.start)
        if (!conflict) return { start, end }
        start = conflict.end
      }
      return { start, end: start + duration / 60 }
    }

    for (const e of preserved) {
      const { start, end } = placeAt(e.occ.origStart, e.occ.duration)
      placed.push({ start, end })
      result.push({
        habitId: e.occ.habit.id,
        dailyLogId: e.occ.log?.id,
        dateKey,
        start,
        end,
        duration: e.occ.duration,
        isRescheduled: start !== e.occ.origStart,
      })
    }
    for (const e of shuffled) {
      const { start, end } = placeAt(e.shuffleStart!, e.occ.duration)
      placed.push({ start, end })
      result.push({
        habitId: e.occ.habit.id,
        dailyLogId: e.occ.log?.id,
        dateKey,
        start,
        end,
        duration: e.occ.duration,
        isRescheduled: true,
      })
    }
  }

  return result
}
