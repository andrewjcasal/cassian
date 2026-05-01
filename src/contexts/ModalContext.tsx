import { useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import { Meeting } from '../types'
import { useUserContext } from './UserContext'
import { supabase } from '../lib/supabase'
import MeetingModal from '../components/MeetingModal'
import CalendarTaskModal from '../components/CalendarTaskModal'
import HabitModal from '../components/HabitModal'
import SessionEditModal from '../components/SessionEditModal'
import NeedHelpModal from '../components/NeedHelpModal'
import CreateHabitModal from '../components/CreateHabitModal'
import {
  ModalContext,
  ModalState,
  ModalContextType,
  CalendarModalHandlers,
  CalendarModalData,
  type CreateHabitDefaults,
} from './useModal'

const initialModalState: ModalState = {
  showMeetingModal: false,
  newMeeting: {
    title: '',
    description: '',
    start_time: '',
    end_time: '',
    date: '',
    location: '',
    meeting_type: 'general',
    priority: 'medium',
    category_id: undefined,
  },
  selectedTimeSlot: null,
  editingMeeting: null,
  showHabitModal: false,
  selectedHabit: null,
  selectedHabitDate: null,
  showTaskModal: false,
  selectedTask: null,
  showSessionModal: false,
  selectedSession: null,
  showResizeConflictDialog: false,
  resizeConflictingTasks: [],
  resizeConflictMeeting: null,
  resizeConflictNewEndTime: null,
  showNeedHelpModal: false,
  showCreateHabitModal: false,
  createHabitDefaults: null,
}

export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUserContext()
  const [modalState, setModalState] = useState<ModalState>(initialModalState)
  const [userSettings, setUserSettings] = useState<any>(null)
  const [calendarData, setCalendarDataState] = useState<CalendarModalData>({})
  // Store handlers in both state (for re-render on change) and a ref (for
  // stable dispatch inside callbacks that outlive the render).
  const [handlers, setHandlers] = useState<CalendarModalHandlers>({})
  const handlersRef = useRef<CalendarModalHandlers>({})
  handlersRef.current = handlers

  // Fetch user settings
  useEffect(() => {
    const fetchUserSettings = async () => {
      if (!user) return

      try {
        const { data: settings, error } = await supabase
          .from('cassian_user_settings')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching user settings:', error)
          return
        }

        setUserSettings(settings)
      } catch (error) {
        console.error('Error fetching user settings:', error)
      }
    }

    fetchUserSettings()
  }, [user])

  // Helper function to close all modals and reset their state (memoized)
  const getClosedModalState = useCallback((prevState: ModalState) => ({
    ...prevState,
    showMeetingModal: false,
    showHabitModal: false,
    showTaskModal: false,
    showSessionModal: false,
    selectedTimeSlot: null,
    editingMeeting: null,
    selectedHabit: null,
    selectedHabitDate: null,
    selectedTask: null,
    selectedSession: null,
    showResizeConflictDialog: false,
    resizeConflictingTasks: [],
    resizeConflictMeeting: null,
    resizeConflictNewEndTime: null,
    showCreateHabitModal: false,
    createHabitDefaults: null,
  }), [])

  const registerModalHandlers = useCallback((next: CalendarModalHandlers) => {
    setHandlers(next)
  }, [])

  const setCalendarModalData = useCallback((data: CalendarModalData) => {
    setCalendarDataState(data)
  }, [])

  const openMeetingModal = useCallback((timeSlot?: { time: string; date: Date; endTime?: string }, editing?: Meeting) => {
    if (editing) {
      const startTime = new Date(editing.start_time)
      const endTime = new Date(editing.end_time)
      setModalState(prev => ({
        ...getClosedModalState(prev),
        showMeetingModal: true,
        editingMeeting: editing,
        newMeeting: {
          title: editing.title,
          description: editing.description || '',
          start_time: startTime.toTimeString().slice(0, 5),
          end_time: endTime.toTimeString().slice(0, 5),
          date: userSettings?.week_ending_timezone
            ? startTime.toLocaleDateString('en-CA', { timeZone: userSettings.week_ending_timezone })
            : startTime.toLocaleDateString('en-CA'),
          location: editing.location || '',
          meeting_type: editing.meeting_type,
          priority: editing.priority,
          category_id: editing.category_id,
        },
      }))
    } else if (timeSlot) {
      const [hour, minute] = timeSlot.time.split(':')
      const startTime = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

      let endTime: string
      if (timeSlot.endTime) {
        endTime = timeSlot.endTime
      } else {
        const startMinutes = parseInt(hour) * 60 + parseInt(minute)
        const endMinutes = startMinutes + 15
        const endHour = Math.floor(endMinutes / 60)
        const endMinute = endMinutes % 60
        endTime = `${endHour.toString().padStart(2, '0')}:${endMinute.toString().padStart(2, '0')}`
      }

      setModalState(prev => ({
        ...getClosedModalState(prev),
        showMeetingModal: true,
        selectedTimeSlot: timeSlot,
        newMeeting: {
          title: '',
          description: '',
          start_time: startTime,
          end_time: endTime,
          date: timeSlot.date.toLocaleDateString('en-CA'),
          location: '',
          meeting_type: 'general',
          priority: 'medium',
          category_id: undefined,
        },
      }))
    } else {
      setModalState(prev => ({
        ...getClosedModalState(prev),
        showMeetingModal: true,
        newMeeting: {
          title: '',
          description: '',
          start_time: '',
          end_time: '',
          date: new Date().toISOString().split('T')[0],
          location: '',
          meeting_type: 'general',
          priority: 'medium',
          category_id: undefined,
        },
      }))
    }
  }, [getClosedModalState, userSettings])

  const closeMeetingModal = () => {
    setModalState(prev => ({
      ...prev,
      showMeetingModal: false,
      selectedTimeSlot: null,
      editingMeeting: null,
    }))
  }

  const setNewMeeting = (meeting: any) => {
    setModalState(prev => ({
      ...prev,
      newMeeting: meeting,
    }))
  }

  const openHabitModal = (habit: any, date: Date) => {
    setModalState(prev => ({
      ...getClosedModalState(prev),
      showHabitModal: true,
      selectedHabit: habit,
      selectedHabitDate: date,
    }))
  }

  const closeHabitModal = () => {
    setModalState(prev => ({
      ...prev,
      showHabitModal: false,
      selectedHabit: null,
      selectedHabitDate: null,
    }))
  }

  const openTaskModal = (task: any) => {
    setModalState(prev => ({
      ...getClosedModalState(prev),
      showTaskModal: true,
      selectedTask: task,
    }))
  }

  const closeTaskModal = () => {
    setModalState(prev => ({
      ...prev,
      showTaskModal: false,
      selectedTask: null,
    }))
  }

  const openSessionModal = (session: any) => {
    setModalState(prev => ({
      ...getClosedModalState(prev),
      showSessionModal: true,
      selectedSession: session,
    }))
  }

  const closeSessionModal = () => {
    setModalState(prev => ({
      ...prev,
      showSessionModal: false,
      selectedSession: null,
    }))
  }

  const closeAllModals = () => {
    setModalState(initialModalState)
  }

  const openResizeConflictDialog = (meeting: any, newEndTime: Date, conflictingTasks: any[]) => {
    setModalState(prev => ({
      ...getClosedModalState(prev),
      showResizeConflictDialog: true,
      resizeConflictMeeting: meeting,
      resizeConflictNewEndTime: newEndTime,
      resizeConflictingTasks: conflictingTasks,
    }))
  }

  const closeResizeConflictDialog = () => {
    setModalState(prev => ({
      ...prev,
      showResizeConflictDialog: false,
      resizeConflictingTasks: [],
      resizeConflictMeeting: null,
      resizeConflictNewEndTime: null,
    }))
  }

  const confirmResizeConflict = async (deleteTasks: boolean) => {
    const { resizeConflictMeeting: meeting, resizeConflictNewEndTime: newEndTime, resizeConflictingTasks: tasks } = modalState
    if (!meeting || !newEndTime) return
    if (deleteTasks) {
      for (const task of tasks) {
        await handlersRef.current.onDeleteTaskLog?.(task.id)
        handlersRef.current.onRemoveTaskLogFromUI?.(task.id)
      }
    }
    await handlersRef.current.onUpdateMeetingEndTime?.(meeting.id, newEndTime.toISOString())
    closeResizeConflictDialog()
  }

  const openNeedHelpModal = () => {
    setModalState(prev => ({ ...prev, showNeedHelpModal: true }))
  }

  const closeNeedHelpModal = () => {
    setModalState(prev => ({ ...prev, showNeedHelpModal: false }))
  }

  const openCreateHabitModal = (defaults?: CreateHabitDefaults) => {
    setModalState(prev => ({
      ...getClosedModalState(prev),
      showCreateHabitModal: true,
      createHabitDefaults: defaults ?? null,
    }))
  }

  const closeCreateHabitModal = () => {
    setModalState(prev => ({ ...prev, showCreateHabitModal: false, createHabitDefaults: null }))
  }

  const value: ModalContextType = {
    ...modalState,
    calendarData,
    openMeetingModal,
    closeMeetingModal,
    setNewMeeting,
    handleSaveMeeting: async (e: React.FormEvent, updatedMeeting: any) => {
      await handlersRef.current.onSaveMeeting?.(e, updatedMeeting, modalState.editingMeeting || undefined)
      closeMeetingModal()
    },
    handleDeleteMeeting: async () => {
      if (modalState.editingMeeting) {
        await handlersRef.current.onDeleteMeeting?.(modalState.editingMeeting)
        closeMeetingModal()
      }
    },
    openHabitModal,
    closeHabitModal,
    openTaskModal,
    closeTaskModal,
    openSessionModal,
    closeSessionModal,
    closeAllModals,
    openResizeConflictDialog,
    closeResizeConflictDialog,
    confirmResizeConflict,
    openNeedHelpModal,
    closeNeedHelpModal,
    openCreateHabitModal,
    closeCreateHabitModal,
    registerModalHandlers,
    setCalendarModalData,
  }

  return (
    <ModalContext.Provider value={value}>
      <MeetingModal
        onAddHabitBlock={handlers.onAddHabitBlock}
        onMeetingHabitLinked={handlers.onMeetingHabitLinked}
        onAddNote={handlers.onAddNote}
        onCreateHabit={defaults => openCreateHabitModal(defaults)}
        previousTitles={calendarData.meetingTitles}
        categories={calendarData.meetingCategories}
        calendarHabits={calendarData.habits}
        archivedHabits={calendarData.archivedHabits}
      />
      <CreateHabitModal
        isOpen={modalState.showCreateHabitModal}
        onClose={closeCreateHabitModal}
        defaultTime={modalState.createHabitDefaults?.time}
        defaultDuration={modalState.createHabitDefaults?.duration}
        defaultWeeklyDays={modalState.createHabitDefaults?.weeklyDays}
        lockedName={modalState.createHabitDefaults?.lockedName}
        existingHabitId={modalState.createHabitDefaults?.existingHabitId}
        onCreateHabit={async habitData => {
          if (handlersRef.current.onCreateHabit) {
            await handlersRef.current.onCreateHabit(habitData)
          }
        }}
        onUnarchive={handlers.onUnarchiveHabit}
      />
      <CalendarTaskModal
        isOpen={modalState.showTaskModal}
        onClose={closeTaskModal}
        task={modalState.selectedTask}
        onComplete={async () => { await handlersRef.current.onCompleteTask?.(modalState.selectedTask); closeTaskModal(); }}
        onDelete={async () => { await handlersRef.current.onDeleteTask?.(modalState.selectedTask); closeTaskModal(); }}
        onUpdate={handlers.onUpdateTask}
      />
      <HabitModal
        onTimeChange={handlers.onHabitTimeChange ?? (async () => {})}
        onSkip={handlers.onHabitSkip ?? (async () => {})}
        onArchive={handlers.onHabitArchive}
      />
      {modalState.selectedSession && (
        <SessionEditModal
          isOpen={modalState.showSessionModal}
          onClose={closeSessionModal}
          session={modalState.selectedSession}
          onUpdateSession={async (sessionId: string, updates: any) => {
            await handlersRef.current.onUpdateSession?.(sessionId, updates)
            closeSessionModal()
          }}
        />
      )}
      {/* Resize conflict dialog */}
      {modalState.showResizeConflictDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-sm mx-4">
            <h3 className="text-sm font-semibold text-neutral-900 mb-2">Task Conflict</h3>
            <p className="text-xs text-neutral-600 mb-3">
              Extending this meeting overlaps with {modalState.resizeConflictingTasks.length} task{modalState.resizeConflictingTasks.length !== 1 ? 's' : ''}:
            </p>
            <ul className="text-xs text-neutral-700 mb-3 space-y-1">
              {modalState.resizeConflictingTasks.map((task: any, i: number) => (
                <li key={i} className="truncate">• {task.tasks?.title || 'Task'}</li>
              ))}
            </ul>
            <div className="flex gap-2 justify-end">
              <button
                onClick={closeResizeConflictDialog}
                className="px-3 py-1.5 text-xs bg-neutral-200 text-neutral-700 rounded hover:bg-neutral-300"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmResizeConflict(false)}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Extend & Keep Tasks
              </button>
              <button
                onClick={() => confirmResizeConflict(true)}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
              >
                Extend & Delete Tasks
              </button>
            </div>
          </div>
        </div>
      )}
      <NeedHelpModal isOpen={modalState.showNeedHelpModal} onClose={closeNeedHelpModal} />
      {children}
    </ModalContext.Provider>
  )
}
