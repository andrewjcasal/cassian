import React from 'react'
import { Clock, Check } from 'lucide-react'
import CalendarEvent from './CalendarEvent'
import { GRID_START_HOUR, isLateNightHour } from '../utils/calendarGrid'

// Unified duration format: takes minutes, outputs "Xh Ym" or "Ym"
const formatDuration = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

// Common styles for all calendar events
const getEventStyle = (
  topPosition: number,
  height: number,
  zIndex: number = 5,
  leftOffset: number = 0,
  widthFraction: number = 1
): React.CSSProperties => ({
  left: `calc(${leftOffset}% + 2px)`,
  width: `calc(${93 * widthFraction}% - 4px)`,
  top: `${topPosition}%`,
  height: `${height - 2}px`, // Reduce height by 2px for separation
  zIndex,
})

interface CalendarEventSlotsProps {
  habitsInSlot: any[]
  sessionsInSlot: any[]
  meetingsInSlot: any[]
  buffersInSlot: any[]
  tasksInSlot: any[]
  tasksDailyLogsInSlot: any[]
  categoryBuffersInSlot: any[]
  timeSlot: string
  date: Date
  dateStr: string
  baseItemHeight: number
  hourHeight?: number
  handleHabitClick: (habit: any, date: Date) => void
  handleSessionClick: (session: any) => void
  handleTaskClick: (task: any) => void
  handleEditMeeting: (meeting: any) => void
  onMeetingResizeStart?: (meeting: any, e: React.MouseEvent) => void
  onMeetingDragStart?: (meeting: any, e: React.MouseEvent) => void
  draggingMeetingId?: string | null
  meetingDragY?: number
  onTaskLogDragStart?: (log: any, e: React.MouseEvent) => void
  draggingTaskLogId?: string | null
  taskLogDragY?: number
  onHabitDragStart?: (habit: any, date: Date, e: React.MouseEvent) => void
  onHabitResizeStart?: (habit: any, date: Date, e: React.MouseEvent) => void
  draggingHabitId?: string | null
  draggingHabitDateStr?: string | null
  habitDragY?: number
}

function CalendarEventSlots({
  habitsInSlot,
  sessionsInSlot,
  meetingsInSlot,
  buffersInSlot,
  tasksInSlot,
  tasksDailyLogsInSlot,
  categoryBuffersInSlot,
  timeSlot,
  date,
  dateStr,
  baseItemHeight,
  hourHeight = 64,
  handleHabitClick,
  handleSessionClick,
  handleTaskClick,
  handleEditMeeting,
  onMeetingResizeStart,
  onMeetingDragStart,
  draggingMeetingId,
  meetingDragY = 0,
  onTaskLogDragStart,
  draggingTaskLogId,
  taskLogDragY = 0,
  onHabitDragStart,
  onHabitResizeStart,
  draggingHabitId,
  draggingHabitDateStr,
  habitDragY = 0,
}: CalendarEventSlotsProps) {
  return (
    <>
      {/* Habits */}
      {habitsInSlot.map((habit, index) => {
        // Calculate effective duration (daily log override or default habit duration)
        const dailyLog = habit.habits_daily_logs?.find(log => log.log_date === dateStr)
        const effectiveDuration = dailyLog?.duration || habit.duration || 0
        const habitHeight = effectiveDuration ? (effectiveDuration / 60) * hourHeight : hourHeight
        const isRescheduled = habit.isRescheduled || false

        const adjustedTopPosition = habit.topPosition || 0

        const isDraggingThis = draggingHabitId === habit.id && draggingHabitDateStr === dateStr
        // Habits sit above meetings in the stacking order (meetings use z=15).
        // When a meeting conflict bumps a habit into the next hour-slot, the
        // meeting's own box can visually overlap that slot — without this, it
        // would obscure the bumped habit.
        const habitStyle = isDraggingThis
          ? { ...getEventStyle(adjustedTopPosition, habitHeight, 20), transform: `translateY(${habitDragY}px)`, opacity: 0.8, zIndex: 50 }
          : getEventStyle(adjustedTopPosition, habitHeight, 20)

        // Completed subhabits for this date — shown in the hover tooltip.
        const finishedSubhabits = (habit.subhabits || []).filter((s: any) =>
          (s.habits_daily_logs || []).some(
            (l: any) => l.log_date === dateStr && l.is_completed === true
          )
        )
        const hoverTooltip = finishedSubhabits.length > 0 ? (
          <div>
            <div className="font-medium text-neutral-900 mb-1">
              Finished ({finishedSubhabits.length}/{(habit.subhabits || []).length})
            </div>
            <ul className="space-y-0.5">
              {finishedSubhabits.map((s: any) => (
                <li key={s.id} className="flex items-center gap-1">
                  <Check className="w-3 h-3 text-green-500 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : undefined

        return (
          <CalendarEvent
            key={`habit-${habit.id}`}
            type="habit"
            style={habitStyle}
            onClick={e => {
              if (isDraggingThis) return
              e.stopPropagation()
              e.preventDefault()
              handleHabitClick(habit, date)
            }}
            onDragStart={onHabitDragStart ? (e: React.MouseEvent) => onHabitDragStart(habit, date, e) : undefined}
            onResizeStart={onHabitResizeStart ? (e: React.MouseEvent) => onHabitResizeStart(habit, date, e) : undefined}
            eventTitle={habit.name}
            duration={
              effectiveDuration > 0 ? formatDuration(effectiveDuration) : undefined
            }
            icon={isRescheduled ? <Clock className="w-1.5 h-1.5" /> : undefined}
            hoverTooltip={hoverTooltip}
          />
        )
      })}

      {/* Sessions */}
      {sessionsInSlot.map((session, index) => {
        const sessionHeight = session.scheduled_hours * hourHeight

        // Calculate position after habits
        const baseTopPosition = session.topPosition || 0
        const verticalOffset = (habitsInSlot.length + index) * baseItemHeight
        const adjustedTopPosition = baseTopPosition + (verticalOffset / hourHeight) * 100

        return (
          <CalendarEvent
            key={`session-${session.id}`}
            type="session"
            style={getEventStyle(adjustedTopPosition, sessionHeight, 10)}
            onClick={e => {
              e.stopPropagation()
              handleSessionClick(session)
            }}
            eventTitle={session.projects?.name || 'Project Session'}
            duration={formatDuration(session.scheduled_hours * 60)}
          />
        )
      })}

      {/* Auto-scheduled Tasks */}
      {tasksInSlot.map(task => {
        const currentHour = parseInt(timeSlot.split(':')[0])
        const taskStartTime = task.startTime || task.startHour

        // Calculate position within the starting hour slot
        const minutesIntoHour = (taskStartTime - currentHour) * 60
        let topPositionInSlot = (minutesIntoHour / 60) * 100

        const taskHeight = (task.estimated_hours || 1) * hourHeight
        const isPlaceholder = task.isPlaceholder || false

        const finalStyle = getEventStyle(topPositionInSlot, taskHeight, 5)

        return (
          <CalendarEvent
            key={`task-${task.id}`}
            type={isPlaceholder ? 'placeholder' : 'task'}
            style={finalStyle}
            onClick={e => {
              e.stopPropagation()
              handleTaskClick(task)
            }}
            eventTitle={`${task.title}${isPlaceholder ? ' \u{1F4B0}' : ''}`}
            duration={formatDuration((task.estimated_hours || 1) * 60)}
          />
        )
      })}

      {/* Meetings */}
      {meetingsInSlot.map(meeting => {
        const meetingEnd = new Date(meeting.end_time)
        const isClipped = !!meeting._clippedStart
        let meetingStart: Date
        let meetingDuration: number
        let topPositionInSlot: number

        if (isClipped) {
          // Clipped entry: starts at the grid's start hour, ends at the
          // original meeting end.
          meetingStart = new Date(meeting.start_time)
          meetingStart.setHours(GRID_START_HOUR, 0, 0, 0)
          topPositionInSlot = 0
          meetingDuration = (meetingEnd.getTime() - meetingStart.getTime()) / (1000 * 60)
        } else {
          meetingStart = new Date(meeting.start_time)
          const startHour = meetingStart.getHours()
          // Late-night meeting extending past the grid start clips there.
          if (isLateNightHour(startHour)) {
            const splitAt = new Date(meetingStart)
            splitAt.setHours(GRID_START_HOUR, 0, 0, 0)
            const clippedEnd = meetingEnd > splitAt ? splitAt : meetingEnd
            meetingDuration = (clippedEnd.getTime() - meetingStart.getTime()) / (1000 * 60)
          } else {
            meetingDuration = (meetingEnd.getTime() - meetingStart.getTime()) / (1000 * 60)
          }
          topPositionInSlot = (meetingStart.getMinutes() / 60) * 100
        }

        const meetingHeight = (meetingDuration / 60) * hourHeight
        const isDraggingThisMeeting = draggingMeetingId === meeting.id && !isClipped
        const baseMeetingStyle = {
          ...getEventStyle(topPositionInSlot, meetingHeight, 15),
          ...(meeting.meeting_habits?.length > 0 ? { backgroundColor: '#dcfce7', color: '#166534' } : {}),
        }
        const meetingStyle = isDraggingThisMeeting
          ? { ...baseMeetingStyle, transform: `translateY(${meetingDragY}px)`, opacity: 0.8, zIndex: 50 }
          : baseMeetingStyle

        return (
          <CalendarEvent
            key={`meeting-${meeting.id}${isClipped ? '-clipped' : ''}`}
            type="meeting"
            style={meetingStyle}
            onClick={e => {
              e.stopPropagation()
              handleEditMeeting(meeting)
            }}
            onDragStart={!isClipped && onMeetingDragStart ? (e) => onMeetingDragStart(meeting, e) : undefined}
            onResizeStart={onMeetingResizeStart ? (e) => onMeetingResizeStart(meeting, e) : undefined}
            eventTitle={meeting.title}
            icon={meeting.meeting_habits?.length > 0 ? <Check className="w-2 h-2" /> : undefined}
            duration={formatDuration(Math.round(meetingDuration))}
          />
        )
      })}

      {/* Task Daily Logs */}
      {tasksDailyLogsInSlot.map(log => {
        // Use actual_duration if available, otherwise fall back to scheduled_duration
        const duration = log.estimated_hours || 1
        const logHeight = duration * hourHeight

        const todayStr = new Date().toLocaleDateString('en-CA')
        const isDatedTodoist = log.tasks?.source === 'todoist' && log.tasks?.due_date
        const isUrgentTodoist = isDatedTodoist && (log.tasks.due_date <= todayStr || log.tasks.due_date === log.log_date)
        const isClickUp = log.tasks?.source === 'clickup'
        const isDragging = draggingTaskLogId === log.id
        const dragStyle = isDragging
          ? { ...getEventStyle(log.topPosition, logHeight, 20), transform: `translateY(${taskLogDragY}px)`, opacity: 0.8, zIndex: 50 }
          : getEventStyle(log.topPosition, logHeight, 20)
        return (
          <CalendarEvent
            key={`task-daily-log-${log.id}`}
            type={isClickUp ? 'clickup' : isUrgentTodoist ? 'tasklog-urgent' : 'tasklog'}
            style={dragStyle}
            onClick={e => {
              if (isDragging) return
              e.stopPropagation()
              handleTaskClick(log.tasks)
            }}
            onDragStart={onTaskLogDragStart ? (e: React.MouseEvent) => onTaskLogDragStart(log, e) : undefined}
            eventTitle={log.tasks?.title || 'Task Log'}
            subtitle={log.tasks?.projects?.name}
            duration={formatDuration(duration * 60)}
          />
        )
      })}

      {/* Buffer Time (Daily Buffers) */}
      {buffersInSlot.map(buffer => {
        const bufferHeight = (buffer.duration / 60) * hourHeight

        return (
          <CalendarEvent
            key={`buffer-${buffer.id}`}
            type={buffer.isReduced ? 'reduced-buffer' : 'buffer'}
            style={getEventStyle(buffer.topPosition || 0, bufferHeight, 8)}
            title={`${buffer.title} - ${formatDuration(buffer.duration)}${
              buffer.isReduced ? ' (reduced due to same day)' : ''
            }`}
            eventTitle={buffer.title}
            duration={formatDuration(buffer.duration)}
          />
        )
      })}

      {/* Category Buffers (Weekly Buffers) */}
      {categoryBuffersInSlot.map(categoryBuffer => {
        const bufferHeight = categoryBuffer.duration * hourHeight // Duration is in hours

        return (
          <CalendarEvent
            key={`category-buffer-${categoryBuffer.id}`}
            type="category-buffer"
            style={getEventStyle(categoryBuffer.topPosition || 0, bufferHeight, 6)}
            title={`${
              categoryBuffer.category_name
            } Buffer - ${categoryBuffer.remaining_hours.toFixed(1)} hours remaining this week`}
            eventTitle={categoryBuffer.category_name}
            subtitle="Buffer Time"
            duration={formatDuration(categoryBuffer.duration * 60)}
          />
        )
      })}


    </>
  )
}

export default React.memo(CalendarEventSlots)
