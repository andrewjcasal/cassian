import { useState, useEffect, useRef, useMemo } from 'react'
import { format } from 'date-fns'
import { Play, Pause, SkipForward, Check, Pencil } from 'lucide-react'
import { getEffectiveHabitStartTime } from '../utils/habitScheduling'
import { formatTimeOfDay } from '../utils/formatTime'
import ModalWrapper from './ModalWrapper'
import { useModal } from '../contexts/useModal'
import { supabase } from '../lib/supabase'

interface HabitModalProps {
  onTimeChange: (habitId: string, date: string, newTime: string, newDuration?: number) => Promise<void>
  onSkip?: (habitId: string, date: string) => Promise<void>
  onArchive?: (habitId: string) => Promise<void>
}

interface Subhabit {
  id: string
  title: string
  duration_minutes: number | null
  habits_daily_logs?: any[]
}

const HabitModal = ({ onTimeChange, onSkip, onArchive }: HabitModalProps) => {
  const {
    showHabitModal,
    selectedHabit: habit,
    selectedHabitDate: selectedDate,
    closeHabitModal,
  } = useModal()
  const [newTime, setNewTime] = useState('')
  const [newDuration, setNewDuration] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [savingFuture, setSavingFuture] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [viewMode, setViewMode] = useState<'readonly' | 'edit'>('readonly')

  interface OccurrenceRow {
    originalDate: string
    date: string
    time: string
    duration: number
    editing: boolean
    saving: boolean
  }
  const [occurrenceRows, setOccurrenceRows] = useState<Record<string, OccurrenceRow>>({})

  const isWeekly = !!(habit?.weekly_days && habit.weekly_days.length > 0)

  const upcomingOccurrences = useMemo(() => {
    if (!isWeekly || !habit || !selectedDate) return [] as { date: Date; dateStr: string }[]
    const logs = habit.habits_daily_logs || []
    const results: { date: Date; dateStr: string }[] = []
    const cursor = new Date(selectedDate)
    cursor.setHours(0, 0, 0, 0)
    for (let i = 0; i < 90 && results.length < 3; i++) {
      const dateStr = format(cursor, 'yyyy-MM-dd')
      const dayName = cursor.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
      const matchesPattern = habit.weekly_days.includes(dayName)
      const hasSkipped = logs.some((l: any) => l.log_date === dateStr && l.is_skipped)
      const nonSkippedLog = logs.find((l: any) => l.log_date === dateStr && !l.is_skipped)
      const include = (matchesPattern && !hasSkipped) || !!nonSkippedLog
      if (include) results.push({ date: new Date(cursor), dateStr })
      cursor.setDate(cursor.getDate() + 1)
    }
    return results
  }, [isWeekly, habit, selectedDate])

  // Subhabits & routine timer state
  const [subhabits, setSubhabits] = useState<Subhabit[]>([])
  const [routineActive, setRoutineActive] = useState(false)
  const [currentSubhabitIndex, setCurrentSubhabitIndex] = useState(0)
  const [secondsRemaining, setSecondsRemaining] = useState(0)
  const [totalSeconds, setTotalSeconds] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set())
  // Subhabit completions persisted to cassian_habits_daily_logs for the
  // selected date. Keyed by subhabit (child habit) id.
  const [completedSubhabitIds, setCompletedSubhabitIds] = useState<Set<string>>(new Set())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (habit && selectedDate) {
      const dateKey = format(selectedDate, 'yyyy-MM-dd')
      const dailyLog = habit.habits_daily_logs?.find((log: any) => log.log_date === dateKey)
      const effectiveStartTime = getEffectiveHabitStartTime(habit, dateKey, dailyLog)
      const effectiveDuration = dailyLog?.duration || habit.duration || 0

      setNewTime(effectiveStartTime || '')
      setNewDuration(effectiveDuration)
      loadSubhabits()
    }
  }, [habit, selectedDate])

  useEffect(() => {
    if (showHabitModal) setViewMode('readonly')
  }, [showHabitModal])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Derive today's completed-state for each subhabit from the daily logs that
  // are already embedded on each subhabit (fetched by useCalendarData), no
  // extra network round-trip needed.
  useEffect(() => {
    if (!selectedDate || subhabits.length === 0) {
      setCompletedSubhabitIds(new Set())
      return
    }
    const dateKey = format(selectedDate, 'yyyy-MM-dd')
    const done = new Set<string>()
    for (const s of subhabits) {
      const completedToday = (s.habits_daily_logs || []).some(
        (l: any) => l.log_date === dateKey && l.is_completed === true
      )
      if (completedToday) done.add(s.id)
    }
    setCompletedSubhabitIds(done)
  }, [selectedDate, subhabits])

  const toggleSubhabitComplete = async (subhabitId: string) => {
    if (!selectedDate || !habit) return
    const dateKey = format(selectedDate, 'yyyy-MM-dd')
    const nowCompleted = !completedSubhabitIds.has(subhabitId)

    // Optimistic UI update.
    setCompletedSubhabitIds(prev => {
      const next = new Set(prev)
      if (nowCompleted) next.add(subhabitId)
      else next.delete(subhabitId)
      return next
    })

    // Keep the subhabit's embedded habits_daily_logs array in sync so the
    // derivation useEffect doesn't snap back to the stale embed if it re-runs.
    const sub = subhabits.find(s => s.id === subhabitId)
    if (sub) {
      const logs = sub.habits_daily_logs || []
      const existingIdx = logs.findIndex((l: any) => l.log_date === dateKey)
      if (existingIdx >= 0) {
        logs[existingIdx] = { ...logs[existingIdx], is_completed: nowCompleted }
      } else if (nowCompleted) {
        logs.push({ habit_id: subhabitId, log_date: dateKey, is_completed: true })
      }
      sub.habits_daily_logs = logs
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Find an existing log for this subhabit+date (any scheduled_start_time).
      const { data: existing } = await supabase
        .from('cassian_habits_daily_logs')
        .select('id')
        .eq('habit_id', subhabitId)
        .eq('user_id', user.id)
        .eq('log_date', dateKey)
        .limit(1)
        .maybeSingle()

      if (existing?.id) {
        await supabase
          .from('cassian_habits_daily_logs')
          .update({ is_completed: nowCompleted })
          .eq('id', existing.id)
      } else if (nowCompleted) {
        await supabase
          .from('cassian_habits_daily_logs')
          .insert({
            habit_id: subhabitId,
            user_id: user.id,
            log_date: dateKey,
            is_completed: true,
          })
      }
    } catch (err) {
      console.error('Error toggling subhabit completion:', err)
      // Revert optimistic state on failure.
      setCompletedSubhabitIds(prev => {
        const next = new Set(prev)
        if (nowCompleted) next.delete(subhabitId)
        else next.add(subhabitId)
        return next
      })
    }
  }

  useEffect(() => {
    if (!isWeekly || !habit) return
    const logs = habit.habits_daily_logs || []
    setOccurrenceRows(prev => {
      const next: Record<string, OccurrenceRow> = {}
      for (const occ of upcomingOccurrences) {
        const log = logs.find((l: any) => l.log_date === occ.dateStr && !l.is_skipped)
        const time = getEffectiveHabitStartTime(habit, occ.dateStr, log) || ''
        const duration = log?.duration || habit.duration || 0
        const existing = prev[occ.dateStr]
        next[occ.dateStr] = existing && existing.editing
          ? existing
          : { originalDate: occ.dateStr, date: occ.dateStr, time, duration, editing: false, saving: false }
      }
      return next
    })
  }, [isWeekly, habit, upcomingOccurrences])

  const updateRow = (key: string, patch: Partial<OccurrenceRow>) => {
    setOccurrenceRows(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  const handleRowSave = async (key: string) => {
    if (!habit) return
    const row = occurrenceRows[key]
    if (!row || !row.time || !row.date) return
    updateRow(key, { saving: true })
    try {
      const movedToNewDate = row.date !== row.originalDate
      if (movedToNewDate && onSkip) {
        await onSkip(habit.id, row.originalDate)
      }
      // onTimeChange is wired to update-by-id when a non-skipped log already
      // exists on this date, and also pushes the change into the calendar's
      // local state, so the UI reflects the edit without a refetch.
      await onTimeChange(habit.id, row.date, row.time, row.duration)
      updateRow(key, { editing: false, saving: false })
    } catch (error) {
      console.error('Error saving occurrence:', error)
      updateRow(key, { saving: false })
    }
  }

  const loadSubhabits = () => {
    if (!habit) return

    // Use todoist imported tasks if configured, otherwise manual subhabits
    if (habit.todoist_filter_labels?.length > 0 && habit.habit_todoist_tasks?.length > 0) {
      const sorted = [...habit.habit_todoist_tasks].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      setSubhabits(sorted.map((t: any) => ({
        id: t.id,
        title: t.title,
        duration_minutes: t.duration_minutes,
      })))
    } else if (habit.subhabits?.length > 0) {
      const sorted = [...habit.subhabits].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      // After the subhabits→habits merge, children are cassian_habits rows —
      // map their native fields (name, duration) onto the UI's expected shape.
      // Pass through habits_daily_logs so we can derive today's completion
      // state without a separate DB query.
      setSubhabits(sorted.map((s: any) => ({
        id: s.id,
        title: s.name ?? s.title,
        duration_minutes: s.duration ?? s.duration_minutes ?? null,
        habits_daily_logs: s.habits_daily_logs || [],
      })))
    } else {
      setSubhabits([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!habit || !selectedDate || !newTime) return

    setLoading(true)
    try {
      const dateString = format(selectedDate, 'yyyy-MM-dd')
      await onTimeChange(habit.id, dateString, newTime, newDuration)
      closeHabitModal()
    } catch (error) {
      console.error('Error updating habit:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveFuture = async () => {
    if (!habit || !newTime) return

    setSavingFuture(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('cassian_habits')
        .update({
          default_start_time: newTime,
          current_start_time: newTime,
          duration: newDuration,
        })
        .eq('id', habit.id)
        .eq('user_id', user.id)
      if (error) throw error
      closeHabitModal()
    } catch (error) {
      console.error('Error updating habit defaults:', error)
    } finally {
      setSavingFuture(false)
    }
  }

  const handleSkip = async () => {
    if (!habit || !selectedDate || !onSkip) return

    setLoading(true)
    try {
      const dateString = format(selectedDate, 'yyyy-MM-dd')
      await onSkip(habit.id, dateString)
      closeHabitModal()
    } catch (error) {
      console.error('Error skipping habit:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleArchive = async () => {
    if (!habit) return

    setArchiving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('cassian_habits')
        .update({ is_archived: true })
        .eq('id', habit.id)
        .eq('user_id', user.id)
      if (error) throw error
      await onArchive?.(habit.id)
      closeHabitModal()
    } catch (error) {
      console.error('Error archiving habit:', error)
    } finally {
      setArchiving(false)
    }
  }

  // Routine timer functions
  const startRoutine = () => {
    setRoutineActive(true)
    setCurrentSubhabitIndex(0)
    setCompletedIndices(new Set())
    startSubhabitTimer(0)
  }

  const startSubhabitTimer = (index: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    const sub = subhabits[index]
    const duration = (sub?.duration_minutes || 5) * 60
    setSecondsRemaining(duration)
    setTotalSeconds(duration)
    setIsPaused(false)

    timerRef.current = setInterval(() => {
      setSecondsRemaining(prev => {
        if (prev <= 1) {
          // Auto-advance to next
          if (timerRef.current) clearInterval(timerRef.current)
          setCompletedIndices(ci => new Set([...ci, index]))
          if (index < subhabits.length - 1) {
            setCurrentSubhabitIndex(index + 1)
            setTimeout(() => startSubhabitTimer(index + 1), 300)
          } else {
            setRoutineActive(false)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const togglePause = () => {
    if (isPaused) {
      // Resume
      setIsPaused(false)
      timerRef.current = setInterval(() => {
        setSecondsRemaining(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current)
            const idx = currentSubhabitIndex
            setCompletedIndices(ci => new Set([...ci, idx]))
            if (idx < subhabits.length - 1) {
              setCurrentSubhabitIndex(idx + 1)
              setTimeout(() => startSubhabitTimer(idx + 1), 300)
            } else {
              setRoutineActive(false)
            }
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } else {
      // Pause
      if (timerRef.current) clearInterval(timerRef.current)
      setIsPaused(true)
    }
  }

  const skipToNext = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    setCompletedIndices(ci => new Set([...ci, currentSubhabitIndex]))
    if (currentSubhabitIndex < subhabits.length - 1) {
      const next = currentSubhabitIndex + 1
      setCurrentSubhabitIndex(next)
      startSubhabitTimer(next)
    } else {
      setRoutineActive(false)
    }
  }

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const progress = totalSeconds > 0 ? (totalSeconds - secondsRemaining) / totalSeconds : 0
  const circumference = 2 * Math.PI * 45
  const strokeDashoffset = circumference * (1 - progress)

  if (!showHabitModal || !habit || !selectedDate) return null

  // Circumference used by the small per-subhabit progress rings.
  const miniR = 7
  const miniCirc = 2 * Math.PI * miniR
  const miniOffset = miniCirc * (1 - progress)

  // Normal edit view
  return (
    <ModalWrapper
      isOpen={showHabitModal}
      onClose={closeHabitModal}
      title="Edit Habit"

      maxWidth={subhabits.length > 0 ? 'lg' : 'md'}
      headerActions={!isWeekly && viewMode === 'readonly' ? (
        <button
          type="button"
          onClick={() => setViewMode('edit')}
          className="p-1 text-neutral-400 hover:text-neutral-600 rounded hover:bg-neutral-100 transition-colors"
          title="Edit habit"
        >
          <Pencil className="w-3 h-3" />
        </button>
      ) : undefined}
    >
      <form onSubmit={handleSubmit} className="space-y-1">
        <div className="flex gap-4">
          <div className="flex-1 min-w-0">
            <div className="mb-1">
              <div className="flex items-center mb-1">
                <span className="font-medium text-neutral-900 text-sm">{habit.name}</span>
              </div>
              <p className="text-xs text-neutral-600">
                {format(selectedDate, 'EEEE, MMMM d, yyyy')}
              </p>
            </div>

        {isWeekly ? (
          /* Next 3 occurrences table — supports moving a single iteration to another day */
          <div className="mb-1 overflow-hidden border border-neutral-200 rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-neutral-50 text-neutral-600">
                <tr>
                  <th className="text-left font-medium px-1 py-1">Date</th>
                  <th className="text-left font-medium px-1 py-1">Time</th>
                  <th className="text-left font-medium px-1 py-1">Dur</th>
                  <th className="px-1 py-1 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {upcomingOccurrences.map(occ => {
                  const row = occurrenceRows[occ.dateStr]
                  if (!row) return null
                  const displayDate = row.date
                    ? format(new Date(`${row.date}T00:00:00`), 'EEEEEE M/d')
                    : ''
                  return (
                    <tr key={occ.dateStr} className="border-t border-neutral-100">
                      <td className="px-1 py-1 align-middle">
                        {row.editing ? (
                          <input
                            type="date"
                            value={row.date}
                            onChange={e => updateRow(occ.dateStr, { date: e.target.value })}
                            className="w-full px-0.5 py-0.5 border border-neutral-300 rounded text-xs appearance-none bg-white"
                            style={{ WebkitAppearance: 'none', colorScheme: 'light', fontSize: '12px' }}
                          />
                        ) : (
                          <span className="text-neutral-900">{displayDate}</span>
                        )}
                      </td>
                      <td className="px-1 py-1 align-middle">
                        {row.editing ? (
                          <input
                            type="time"
                            value={row.time}
                            onChange={e => updateRow(occ.dateStr, { time: e.target.value })}
                            className="w-full px-0.5 py-0.5 border border-neutral-300 rounded text-xs appearance-none bg-white"
                            style={{ WebkitAppearance: 'none', colorScheme: 'light', fontSize: '12px' }}
                          />
                        ) : (
                          <span className="text-neutral-900">{formatTimeOfDay(row.time, '—')}</span>
                        )}
                      </td>
                      <td className="px-1 py-1 align-middle">
                        {row.editing ? (
                          <input
                            type="number"
                            min="0"
                            value={row.duration}
                            onChange={e => updateRow(occ.dateStr, { duration: parseInt(e.target.value) || 0 })}
                            className="w-10 px-0.5 py-0.5 border border-neutral-300 rounded text-xs appearance-none bg-white"
                            style={{ WebkitAppearance: 'none', fontSize: '12px' }}
                          />
                        ) : (
                          <span className="text-neutral-900">{row.duration}m</span>
                        )}
                      </td>
                      <td className="px-1 py-1 text-right align-middle">
                        {row.editing ? (
                          <button
                            type="button"
                            onClick={() => handleRowSave(occ.dateStr)}
                            disabled={row.saving || !row.time || !row.date}
                            className="px-2 py-0.5 bg-primary-600 text-white rounded text-[11px] hover:bg-primary-700 disabled:opacity-50"
                          >
                            {row.saving ? '…' : 'Save'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => updateRow(occ.dateStr, { editing: true })}
                            className="p-1 text-neutral-500 hover:text-neutral-800"
                            aria-label="Edit occurrence"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {upcomingOccurrences.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-center text-neutral-500">
                      No upcoming occurrences
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : viewMode === 'readonly' ? (
          <div className="space-y-1 mb-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-neutral-700 w-16 shrink-0">Time</span>
              <span className="text-sm text-neutral-900">{formatTimeOfDay(newTime, '—')}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-neutral-700 w-16 shrink-0">Duration</span>
              <span className="text-sm text-neutral-900">{newDuration} min</span>
            </div>
          </div>
        ) : (
          <div className="space-y-1 mb-2">
            <div className="flex items-baseline gap-2">
              <label htmlFor="time" className="text-xs font-medium text-neutral-700 w-16 shrink-0">
                Time
              </label>
              <input
                type="time"
                id="time"
                value={newTime}
                onChange={e => setNewTime(e.target.value)}
                className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-neutral-900 appearance-none cursor-pointer focus:outline-none focus:ring-0 no-picker-icon"
                style={{ WebkitAppearance: 'none', colorScheme: 'light', fontSize: '14px' }}
                required
              />
            </div>
            <div className="flex items-baseline gap-2">
              <label htmlFor="duration" className="text-xs font-medium text-neutral-700 w-16 shrink-0">
                Duration
              </label>
              <input
                type="number"
                id="duration"
                value={newDuration}
                onChange={e => setNewDuration(parseInt(e.target.value) || 0)}
                className="w-14 bg-transparent border-0 p-0 text-sm text-neutral-900 appearance-none cursor-pointer focus:outline-none focus:ring-0"
                style={{ WebkitAppearance: 'none', fontSize: '14px' }}
                min="0"
              />
              <span className="text-sm text-neutral-500">min</span>
            </div>
          </div>
        )}
          </div>

          {subhabits.length > 0 && (
            <div className="w-48 shrink-0 border-l border-neutral-200 pl-3">
              <div className="flex items-center justify-between mb-1">
                {routineActive ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={togglePause}
                      className="p-0.5 rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors"
                      title={isPaused ? 'Resume' : 'Pause'}
                    >
                      {isPaused ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={skipToNext}
                      className="p-0.5 rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors"
                      title="Skip to next"
                    >
                      <SkipForward className="w-2.5 h-2.5" />
                    </button>
                    <span className="text-[11px] text-neutral-500 ml-1">
                      {currentSubhabitIndex + 1}/{subhabits.length}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={startRoutine}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    <Play className="w-3 h-3" />
                    Start Routine
                    <span className="text-neutral-400 font-normal">· {subhabits.length}</span>
                  </button>
                )}
              </div>
              <ul className="space-y-0.5 max-h-48 overflow-y-auto pr-1">
                {subhabits.map((sub, i) => {
                  const isActive = routineActive && i === currentSubhabitIndex
                  // DB-backed completion (only set by explicit click).
                  const isDone = completedSubhabitIds.has(sub.id)
                  // Routine timer elapsed past this step — visual hint only, no
                  // DB write until the user actually clicks to mark it done.
                  const isTimerElapsed = completedIndices.has(i) && !isDone
                  return (
                  <li
                    key={sub.id}
                    className={`flex items-center gap-2 text-xs ${
                      isActive ? 'text-blue-700 font-semibold'
                      : isDone ? 'text-neutral-400 line-through'
                      : isTimerElapsed ? 'text-neutral-500'
                      : 'text-neutral-600'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSubhabitComplete(sub.id)}
                      className="shrink-0 flex items-center justify-center rounded-full group"
                      title={isDone ? 'Mark as not done' : 'Mark as done'}
                    >
                      {isDone ? (
                        <Check className="w-3.5 h-3.5 text-green-500" />
                      ) : (
                        <svg className="w-3.5 h-3.5 -rotate-90" viewBox="0 0 20 20">
                          <circle
                            cx="10" cy="10" r={miniR}
                            fill={isTimerElapsed ? '#bfdbfe' : 'none'}
                            stroke={isActive ? '#dbeafe' : isTimerElapsed ? '#93c5fd' : '#e5e7eb'}
                            strokeWidth={isActive ? 3 : 1.5}
                            className="group-hover:stroke-orange-400 group-hover:fill-orange-100"
                          />
                          {isActive && (
                            <circle
                              cx="10" cy="10" r={miniR}
                              fill="none"
                              stroke={secondsRemaining <= 10 ? '#ef4444' : '#2563eb'}
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeDasharray={miniCirc}
                              strokeDashoffset={miniOffset}
                              className="transition-all duration-1000 ease-linear"
                            />
                          )}
                        </svg>
                      )}
                    </button>
                    <span className="truncate">{sub.title}</span>
                    {sub.duration_minutes && (
                      <span className="ml-auto text-neutral-400 shrink-0">
                        {isActive ? formatTime(secondsRemaining) : `${sub.duration_minutes}m`}
                      </span>
                    )}
                  </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="flex justify-between gap-1 pt-1">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={closeHabitModal}
              className="px-2 py-1 text-neutral-600 text-xs hover:text-neutral-800"
            >
              Cancel
            </button>
            {onSkip && (
              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="px-2 py-1 bg-orange-600 text-white rounded text-xs hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Skipping...' : 'Skip Today'}
              </button>
            )}
            <button
              type="button"
              onClick={handleArchive}
              disabled={archiving}
              className="px-2 py-1 bg-neutral-200 text-neutral-700 rounded text-xs hover:bg-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Hide this habit going forward (history is preserved)"
            >
              {archiving ? 'Hiding...' : 'Hide'}
            </button>
          </div>
          {!isWeekly && viewMode === 'edit' && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={handleSaveFuture}
                disabled={savingFuture || loading || !newTime}
                className="px-2 py-1 bg-neutral-200 text-neutral-800 rounded text-xs hover:bg-neutral-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingFuture ? 'Saving...' : 'Save Future'}
              </button>
              <button
                type="submit"
                disabled={loading || savingFuture || !newTime}
                className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Saving...' : 'Save Today'}
              </button>
            </div>
          )}
        </div>
      </form>
    </ModalWrapper>
  )
}

export default HabitModal
