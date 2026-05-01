import { createContext, useContext, useEffect } from 'react'
import { Meeting } from '../types'

// Shared types + context + hooks live in this non-component file so that
// React Fast Refresh can hot-swap the ModalProvider component without
// orphaning consumers' useContext subscriptions. See:
// https://github.com/facebook/react/issues/#fast-refresh-component-and-non-component-exports
// (same file must not export both components and hooks)

export interface ModalState {
  // Meeting Modal
  showMeetingModal: boolean
  newMeeting: {
    title: string
    description: string
    start_time: string
    end_time: string
    date: string
    location: string
    meeting_type: Meeting['meeting_type']
    priority: Meeting['priority']
    category_id?: string
  }
  selectedTimeSlot: { time: string; date: Date } | null
  editingMeeting: Meeting | null

  // Habit Modal
  showHabitModal: boolean
  selectedHabit: any | null
  selectedHabitDate: Date | null

  // Task Modal
  showTaskModal: boolean
  selectedTask: any | null

  // Session Modal
  showSessionModal: boolean
  selectedSession: any | null

  // Resize Conflict Dialog
  showResizeConflictDialog: boolean
  resizeConflictingTasks: any[]
  resizeConflictMeeting: any | null
  resizeConflictNewEndTime: Date | null

  // Need Help modal
  showNeedHelpModal: boolean

  // Create Habit modal
  showCreateHabitModal: boolean
  createHabitDefaults: CreateHabitDefaults | null
}

export interface CreateHabitDefaults {
  time?: string
  duration?: number
  weeklyDays?: string[]
  lockedName?: string
  existingHabitId?: string
}

export interface CalendarModalHandlers {
  onSaveMeeting?: (e: React.FormEvent, meeting: any, editingMeeting?: Meeting) => Promise<void>
  onDeleteMeeting?: (meeting: Meeting) => Promise<void>
  onCompleteTask?: (task: any) => Promise<void>
  onDeleteTask?: (task: any) => Promise<void>
  onUpdateTask?: (
    task: any,
    changes: { dueDate?: string | null; durationMinutes?: number }
  ) => Promise<void>
  onHabitTimeChange?: (habitId: string, date: string, newTime: string, newDuration?: number) => Promise<void>
  onHabitSkip?: (habit: any, date: Date) => Promise<void>
  onHabitArchive?: (habitId: string) => Promise<void>
  onUnarchiveHabit?: (
    habitId: string,
    updates: { duration: number; default_start_time: string; weekly_days: string[] | null }
  ) => Promise<void>
  onUpdateSession?: (sessionId: string, updates: any) => Promise<void>
  onTaskLogCreated?: () => void
  onUpdateMeetingEndTime?: (meetingId: string, newEndTime: string) => Promise<void>
  onDeleteTaskLog?: (logId: string) => Promise<void>
  onRemoveTaskLogFromUI?: (logId: string) => void
  onAddHabitBlock?: (habitId: string, date: string, startTime: string, duration: number) => void
  onMeetingHabitLinked?: (meetingId: string, habitId: string) => void
  onAddNote?: () => void
  onCreateHabit?: (habitData: {
    name: string
    duration: number
    habit_type_id: string
    default_start_time?: string
    background: string
    benefits: string
    consequences: string
    weekly_days?: string[] | null
  }) => Promise<void>
}

export interface CalendarModalData {
  meetingTitles?: { title: string; count: number; lastUsed: Date }[]
  meetingCategories?: { id: string; name: string; color: string }[]
  habits?: any[]
  archivedHabits?: {
    id: string
    name: string
    duration: number | null
    default_start_time: string | null
    weekly_days: string[] | null
  }[]
}

export interface ModalActions {
  openMeetingModal: (timeSlot?: { time: string; date: Date; endTime?: string }, editing?: Meeting) => void
  closeMeetingModal: () => void
  setNewMeeting: (meeting: any) => void
  handleSaveMeeting: (e: React.FormEvent, updatedMeeting: ModalState['newMeeting'], editingMeeting?: Meeting) => Promise<void>
  handleDeleteMeeting: (meeting: Meeting) => Promise<void>

  openHabitModal: (habit: any, date: Date) => void
  closeHabitModal: () => void

  openTaskModal: (task: any) => void
  closeTaskModal: () => void

  openSessionModal: (session: any) => void
  closeSessionModal: () => void

  closeAllModals: () => void

  openResizeConflictDialog: (meeting: any, newEndTime: Date, conflictingTasks: any[]) => void
  closeResizeConflictDialog: () => void
  confirmResizeConflict: (deleteTasks: boolean) => Promise<void>

  openNeedHelpModal: () => void
  closeNeedHelpModal: () => void

  openCreateHabitModal: (defaults?: CreateHabitDefaults) => void
  closeCreateHabitModal: () => void

  registerModalHandlers: (handlers: CalendarModalHandlers) => void
  setCalendarModalData: (data: CalendarModalData) => void
}

export interface ModalContextType extends ModalState, ModalActions {
  calendarData: CalendarModalData
}

export const ModalContext = createContext<ModalContextType | undefined>(undefined)

export const useModal = () => {
  const context = useContext(ModalContext)
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider')
  }
  return context
}

/**
 * Calendar page calls this on mount to wire its handlers + data into the
 * site-wide ModalProvider. Passing new objects re-registers automatically.
 */
export const useRegisterCalendarModal = (
  handlers: CalendarModalHandlers,
  data: CalendarModalData
) => {
  const { registerModalHandlers, setCalendarModalData } = useModal()
  useEffect(() => {
    registerModalHandlers(handlers)
  }, [handlers, registerModalHandlers])
  useEffect(() => {
    setCalendarModalData(data)
  }, [data, setCalendarModalData])
}
