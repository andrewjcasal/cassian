import { format } from 'date-fns'
import { Pencil } from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { Meeting } from '../types'
import { supabase } from '../lib/supabase'
import ModalWrapper from './ModalWrapper'
import { useModal } from '../contexts/useModal'
import { useUserContext } from '../contexts/UserContext'
import { toHHMM, minutesBetween } from '../utils/formatTime'

interface Category {
  id: string
  name: string
  color: string
}

interface ProjectOption {
  id: string
  name: string
  color?: string | null
}

interface MeetingModalProps {
  onAddHabitBlock?: (habitId: string, date: string, startTime: string, duration: number) => void
  onMeetingHabitLinked?: (meetingId: string, habitId: string) => void
  onAddNote?: () => void
  onCreateHabit?: (defaults?: { time?: string; duration?: number; weeklyDays?: string[] }) => void
  previousTitles?: { title: string; count: number; lastUsed: Date }[]
  categories?: Category[]
  calendarHabits?: any[]
  projects?: ProjectOption[]
}

const MeetingModal = ({ onAddHabitBlock, onMeetingHabitLinked, onAddNote, onCreateHabit, previousTitles = [], categories = [], calendarHabits = [], projects = [] }: MeetingModalProps) => {
  const {
    showMeetingModal,
    newMeeting: meeting,
    selectedTimeSlot,
    editingMeeting,
    closeMeetingModal,
    setNewMeeting,
    handleSaveMeeting,
    handleSaveProjectActivity,
    handleDeleteMeeting,
  } = useModal()
  const { user } = useUserContext()
  const [showTitleDropdown, setShowTitleDropdown] = useState(false)
  const [showLocationField, setShowLocationField] = useState(false)
  const [showDescriptionField, setShowDescriptionField] = useState(false)
  const [showFullForm, setShowFullForm] = useState(false)
  const [localTitle, setLocalTitle] = useState(meeting.title)
  const [viewMode, setViewMode] = useState<'readonly' | 'edit' | 'create-habit' | 'link-habit' | 'project-activity'>('readonly')
  const [activityProjectId, setActivityProjectId] = useState('')
  const [activityNote, setActivityNote] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const [newHabitName, setNewHabitName] = useState('')
  const [newHabitDuration, setNewHabitDuration] = useState(30)
  const [newHabitStartTime, setNewHabitStartTime] = useState('09:00')
  const [creatingHabit, setCreatingHabit] = useState(false)
  const [allHabits, setAllHabits] = useState<any[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState('')
  const [linkingHabit, setLinkingHabit] = useState(false)

  // Derive skipped habits from calendar data
  const skippedHabits = useMemo(() => {
    if (!selectedTimeSlot || calendarHabits.length === 0) return []
    const dateStr = format(selectedTimeSlot.date, 'yyyy-MM-dd')
    return calendarHabits.filter(h =>
      h.habits_daily_logs?.some((log: any) => log.log_date === dateStr && log.is_skipped)
    )
  }, [calendarHabits, selectedTimeSlot])

  // Sync local title with meeting prop when modal opens
  useEffect(() => {
    if (showMeetingModal) {
      setLocalTitle(meeting.title)
      // New meetings go straight to edit, existing meetings show readonly
      setViewMode(editingMeeting ? 'readonly' : 'edit')
      setShowLocationField(false)
      setShowDescriptionField(false)
      setShowFullForm(false)
      setActivityProjectId('')
      setActivityNote('')
    }
  }, [showMeetingModal, meeting.title])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMeetingModal()
        setShowTitleDropdown(false)
      }
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element
      if (!target.closest('.title-dropdown-container')) {
        setShowTitleDropdown(false)
      }
    }

    if (showMeetingModal) {
      document.addEventListener('keydown', handleKeyDown)
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMeetingModal, closeMeetingModal])

  // Memoize filtered titles computation - MUST be called before any conditional returns
  const filteredTitles = useMemo(() => {
    return previousTitles
      .filter(
        titleData =>
          localTitle.length === 0 ||
          titleData.title.toLowerCase().includes(localTitle.toLowerCase())
      )
      .slice(0, 10)
  }, [previousTitles, localTitle])


  const handleAddHabitBlock = async (habit: any) => {
    if (!user || !selectedTimeSlot) return
    const dateStr = format(selectedTimeSlot.date, 'yyyy-MM-dd')
    const startTime = `${selectedTimeSlot.time}:00`

    // Prefer the dragged range (meeting.start_time → meeting.end_time) for
    // duration so a 9:30–10:00 drag creates a 30-min block instead of the
    // habit's full default duration. Fall back to habit.duration.
    const draggedMin = minutesBetween(meeting.start_time, meeting.end_time)
    const durationMin = draggedMin ?? habit.duration ?? 15

    // Delete skipped log for this habit+date (if any)
    await supabase
      .from('cassian_habits_daily_logs')
      .delete()
      .eq('habit_id', habit.id)
      .eq('user_id', user.id)
      .eq('log_date', dateStr)
      .eq('is_skipped', true)

    // Insert the new block
    await supabase.from('cassian_habits_daily_logs').upsert({
      habit_id: habit.id,
      user_id: user.id,
      log_date: dateStr,
      scheduled_start_time: startTime,
      duration: durationMin,
      is_skipped: false,
      is_completed: false,
    }, {
      onConflict: 'habit_id,user_id,log_date,scheduled_start_time',
    })

    onAddHabitBlock?.(habit.id, dateStr, startTime, durationMin)
    closeMeetingModal()
  }

  const fetchHabitsForLinking = async () => {
    if (!user) return
    const { data } = await supabase
      .from('cassian_habits')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('is_visible', true)
      .or('is_archived.eq.false,is_archived.is.null')
      .order('name')
    setAllHabits(data || [])
  }

  const handleLinkHabit = async () => {
    if (!selectedHabitId || !editingMeeting || !user) return
    setLinkingHabit(true)
    try {
      await supabase.from('cassian_meeting_habits').insert({
        meeting_id: editingMeeting.id,
        habit_id: selectedHabitId,
        user_id: user.id,
      })
      onMeetingHabitLinked?.(editingMeeting.id, selectedHabitId)
      closeMeetingModal()
    } catch (err) {
      console.error('Error linking habit:', err)
    } finally {
      setLinkingHabit(false)
    }
  }

  const handleCreateHabitFromMeeting = async () => {
    if (!newHabitName.trim() || !user || !editingMeeting) return
    setCreatingHabit(true)
    try {
      // Find "fixed" habit type
      const { data: fixedType } = await supabase
        .from('cassian_habits_types')
        .select('id')
        .eq('scheduling_rule', 'fixed_time')
        .single()

      if (!fixedType) return

      // Create the habit
      const { data: habit, error: habitError } = await supabase
        .from('cassian_habits')
        .insert({
          name: newHabitName.trim(),
          duration: newHabitDuration,
          habit_type_id: fixedType.id,
          default_start_time: newHabitStartTime,
          current_start_time: newHabitStartTime,
          user_id: user.id,
          is_visible: true,
        })
        .select()
        .single()

      if (habitError || !habit) throw habitError

      // Link habit to meeting
      await supabase.from('cassian_meeting_habits').insert({
        meeting_id: editingMeeting.id,
        habit_id: habit.id,
        user_id: user.id,
      })

      onMeetingHabitLinked?.(editingMeeting.id, habit.id)
      closeMeetingModal()
    } catch (err) {
      console.error('Error creating habit from meeting:', err)
    } finally {
      setCreatingHabit(false)
    }
  }

  const buildIso = (timeOrIso: string, dateStr: string): string => {
    if (typeof timeOrIso === 'string' && timeOrIso.includes('T')) return timeOrIso
    return new Date(`${dateStr}T${timeOrIso}:00`).toISOString()
  }

  const handleSubmitProjectActivity = async () => {
    if (!activityProjectId || !meeting.date || !meeting.start_time || !meeting.end_time) return
    setSavingActivity(true)
    try {
      const startIso = buildIso(meeting.start_time, meeting.date)
      let endIso = buildIso(meeting.end_time, meeting.date)
      // Cross-midnight: if end <= start, push end to the next day.
      if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        const end = new Date(endIso)
        end.setDate(end.getDate() + 1)
        endIso = end.toISOString()
      }
      await handleSaveProjectActivity({
        project_id: activityProjectId,
        start_time: startIso,
        end_time: endIso,
        note: activityNote.trim() || undefined,
      })
    } catch (err) {
      console.error('Error saving project activity:', err)
    } finally {
      setSavingActivity(false)
    }
  }

  // Return null AFTER all hooks have been called to maintain hook order
  if (!showMeetingModal) return null

  const getTitle = () => {
    if (viewMode === 'create-habit') return 'Create Habit'
    if (viewMode === 'project-activity') return 'Track Project Time'
    if (viewMode === 'edit') return editingMeeting ? 'Edit Meeting' : 'Add Meeting'
    return meeting.title || 'Meeting'
  }

  return (
    <>
      <ModalWrapper
        isOpen={showMeetingModal}
        onClose={closeMeetingModal}
        title={getTitle()}
        maxWidth={selectedTimeSlot ? 'lg' : 'md'}
        headerActions={viewMode === 'readonly' && editingMeeting ? (
          <button
            onClick={() => setViewMode('edit')}
            className="p-1 text-neutral-400 hover:text-neutral-600 rounded hover:bg-neutral-100 transition-colors"
            title="Edit meeting"
          >
            <Pencil className="w-3 h-3" />
          </button>
        ) : undefined}
      >
        {/* Readonly view for existing meetings */}
        {viewMode === 'readonly' && editingMeeting ? (
          <div className="space-y-2">
            <div className="text-xs text-neutral-500">
              {format(new Date(editingMeeting.start_time), 'EEEE, MMM d, yyyy')}
            </div>
            <div className="flex items-center gap-2 text-xs text-neutral-700">
              <span>{format(new Date(editingMeeting.start_time), 'h:mm a')}</span>
              <span className="text-neutral-400">—</span>
              <span>{format(new Date(editingMeeting.end_time), 'h:mm a')}</span>
              <span className="text-neutral-400">
                ({Math.round((new Date(editingMeeting.end_time).getTime() - new Date(editingMeeting.start_time).getTime()) / 60000)} min)
              </span>
            </div>
            {editingMeeting.location && (
              <p className="text-xs text-neutral-500">{editingMeeting.location}</p>
            )}
            {editingMeeting.description && (
              <p className="text-xs text-neutral-500">{editingMeeting.description}</p>
            )}
            <div className="pt-2 border-t border-neutral-100 flex gap-2">
              <button
                onClick={() => {
                  setNewHabitName(editingMeeting.title)
                  const ms = new Date(editingMeeting.start_time)
                  setNewHabitStartTime(`${ms.getHours().toString().padStart(2, '0')}:${ms.getMinutes().toString().padStart(2, '0')}`)
                  const dur = Math.round((new Date(editingMeeting.end_time).getTime() - ms.getTime()) / 60000)
                  setNewHabitDuration(dur > 0 ? dur : 30)
                  setViewMode('create-habit')
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create new habit
              </button>
              <button
                onClick={() => {
                  fetchHabitsForLinking()
                  setSelectedHabitId('')
                  setViewMode('link-habit')
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-neutral-700 bg-neutral-200 rounded-lg hover:bg-neutral-300 transition-colors"
              >
                Link existing habit
              </button>
              {editingMeeting.google_event_id && (
                <button
                  onClick={async () => {
                    await supabase
                      .from('cassian_meetings')
                      .update({ is_ignored: true })
                      .eq('id', editingMeeting.id)
                    closeMeetingModal()
                    window.location.reload()
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors w-full justify-center mt-1"
                >
                  Ignore this event
                </button>
              )}
            </div>
          </div>

        ) : viewMode === 'project-activity' ? (
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Project</label>
              <select
                value={activityProjectId}
                onChange={e => setActivityProjectId(e.target.value)}
                className="w-full px-2 py-1 border border-neutral-300 rounded-md text-xs"
                autoFocus
              >
                <option value="">Choose project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-1">
              <input
                type="date"
                value={meeting.date}
                onChange={e => setNewMeeting({ ...meeting, date: e.target.value })}
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
                required
              />
              <input
                type="time"
                value={typeof meeting.start_time === 'string' && meeting.start_time.includes('T')
                  ? new Date(meeting.start_time).toTimeString().slice(0, 5)
                  : meeting.start_time}
                onChange={e => setNewMeeting({ ...meeting, start_time: e.target.value })}
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
                required
              />
              <input
                type="time"
                value={typeof meeting.end_time === 'string' && meeting.end_time.includes('T')
                  ? new Date(meeting.end_time).toTimeString().slice(0, 5)
                  : meeting.end_time}
                onChange={e => setNewMeeting({ ...meeting, end_time: e.target.value })}
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
                required
              />
            </div>
            <input
              type="text"
              placeholder="Note (optional)"
              value={activityNote}
              onChange={e => setActivityNote(e.target.value)}
              className="w-full px-1 py-1 border border-neutral-300 rounded-md text-xs"
            />
            <div className="flex items-center justify-end gap-1 pt-1">
              <button
                type="button"
                onClick={closeMeetingModal}
                className="px-2 py-1 text-neutral-600 text-xs hover:text-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitProjectActivity}
                disabled={savingActivity || !activityProjectId}
                className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingActivity ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

        ) : viewMode === 'link-habit' && editingMeeting ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Select a habit</label>
              <select
                value={selectedHabitId}
                onChange={e => setSelectedHabitId(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="">Choose habit...</option>
                {allHabits.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setViewMode('readonly')}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:text-neutral-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleLinkHabit}
                disabled={linkingHabit || !selectedHabitId}
                className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {linkingHabit ? 'Linking...' : 'Link Habit'}
              </button>
            </div>
          </div>

        ) : viewMode === 'create-habit' && editingMeeting ? (
          <div className="space-y-3">
            <p className="text-xs text-neutral-500">
              This habit will start today and repeat going forward.
            </p>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Name</label>
              <input
                type="text"
                value={newHabitName}
                onChange={e => setNewHabitName(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-600 mb-1">Start time</label>
                <input
                  type="time"
                  value={newHabitStartTime}
                  onChange={e => setNewHabitStartTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-neutral-600 mb-1">Duration (min)</label>
                <input
                  type="number"
                  value={newHabitDuration}
                  onChange={e => setNewHabitDuration(parseInt(e.target.value) || 0)}
                  className="w-full px-2.5 py-1.5 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
                  min="1"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setViewMode('readonly')}
                className="px-3 py-1.5 text-xs text-neutral-600 hover:text-neutral-800"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleCreateHabitFromMeeting}
                disabled={creatingHabit || !newHabitName.trim()}
                className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {creatingHabit ? 'Creating...' : 'Create Habit'}
              </button>
            </div>
          </div>

        ) : !editingMeeting && !showFullForm && previousTitles.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {previousTitles.slice(0, 12).map((titleData, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      setLocalTitle(titleData.title)
                      const updatedMeeting = { ...meeting, title: titleData.title }
                      setNewMeeting(updatedMeeting)
                      handleSaveMeeting(new Event('submit') as any, updatedMeeting)
                    }}
                    className="px-2 py-0.5 rounded-full text-xs border bg-neutral-50 border-neutral-200 text-neutral-700 hover:bg-primary-50 hover:border-primary-300 hover:text-primary-700 transition-colors"
                  >
                    {titleData.title.length > 25 ? titleData.title.slice(0, 25) + '…' : titleData.title}
                  </button>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowFullForm(true)}
                  className="text-xs text-primary-600 hover:text-primary-800"
                >
                  + Different meeting
                </button>
                {onAddNote && (
                  <button
                    type="button"
                    onClick={() => {
                      closeMeetingModal()
                      onAddNote()
                    }}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  >
                    + Add note
                  </button>
                )}
                {projects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivityProjectId('')
                      setActivityNote('')
                      setViewMode('project-activity')
                    }}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  >
                    + Project activity
                  </button>
                )}
                {onCreateHabit && (
                  <button
                    type="button"
                    onClick={() => {
                      // Pre-populate the Create Habit modal with the clicked
                      // slot's start time and duration.
                      const startHHMM = toHHMM(meeting.start_time)
                      const durationMin = minutesBetween(meeting.start_time, meeting.end_time)
                      // Derive the weekday for the clicked date so the habit
                      // starts as weekly-on-that-day. User can toggle others.
                      let weeklyDays: string[] | undefined
                      if (meeting.date) {
                        const [y, m, d] = meeting.date.split('-').map(Number)
                        if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
                          const dayName = new Date(y, m - 1, d)
                            .toLocaleDateString('en-US', { weekday: 'long' })
                            .toLowerCase()
                          weeklyDays = [dayName]
                        }
                      }
                      closeMeetingModal()
                      onCreateHabit({ time: startHHMM || undefined, duration: durationMin, weeklyDays })
                    }}
                    className="text-xs text-primary-600 hover:text-primary-800"
                  >
                    + Create habit
                  </button>
                )}
              </div>
              {skippedHabits.length > 0 && (
                <div className="pt-2 border-t border-neutral-100">
                  <p className="text-xs text-neutral-400 mb-1.5">Skipped habits</p>
                  <div className="flex flex-wrap gap-1.5">
                    {skippedHabits.map(habit => (
                      <button
                        key={habit.id}
                        type="button"
                        onClick={() => handleAddHabitBlock(habit)}
                        className="px-2 py-0.5 rounded-full text-xs border bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors"
                      >
                        {habit.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
          <form
            onSubmit={e => {
              e.preventDefault()
              const updatedMeeting = { ...meeting, title: localTitle }
              setNewMeeting(updatedMeeting)
              closeMeetingModal()
              handleSaveMeeting(e, updatedMeeting)
            }}
            className="space-y-1"
          >
            <div className="relative">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Meeting title"
                  value={localTitle}
                  onChange={e => setLocalTitle(e.target.value)}
                  className="w-full px-1 py-1 border border-neutral-300 rounded-md text-xs"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="flex gap-1">
              <input
                type="date"
                value={meeting.date}
                onChange={e => setNewMeeting({ ...meeting, date: e.target.value })}
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
                required
              />
              <input
                type="time"
                value={typeof meeting.start_time === 'string' && meeting.start_time.includes('T') 
                  ? new Date(meeting.start_time).toTimeString().slice(0, 5)
                  : meeting.start_time}
                onChange={e => {
                  const newStartTime = e.target.value

                  try {
                    // Create full timestamp for start_time with validation
                    const startDateTime = new Date(meeting.date + 'T' + newStartTime + ':00')
                    if (isNaN(startDateTime.getTime())) {
                      console.error('Invalid start date created:', meeting.date, newStartTime)
                      return
                    }

                    // Calculate current duration if end_time exists
                    let newEndDateTime = startDateTime
                    if (meeting.end_time) {
                      let currentEndTime, currentStartTime
                      
                      // Parse current end time with validation
                      if (typeof meeting.end_time === 'string' && meeting.end_time.includes('T')) {
                        currentEndTime = new Date(meeting.end_time)
                      } else {
                        currentEndTime = new Date(meeting.date + 'T' + meeting.end_time + ':00')
                      }
                      
                      // Parse current start time with validation
                      if (typeof meeting.start_time === 'string' && meeting.start_time.includes('T')) {
                        currentStartTime = new Date(meeting.start_time)
                      } else {
                        currentStartTime = new Date(meeting.date + 'T' + meeting.start_time + ':00')
                      }
                      
                      // Validate parsed dates
                      if (isNaN(currentEndTime.getTime()) || isNaN(currentStartTime.getTime())) {
                        console.error('Invalid current times:', meeting.end_time, meeting.start_time)
                        // Use 15-minute default duration if current times are invalid
                        newEndDateTime = new Date(startDateTime.getTime() + (15 * 60 * 1000))
                      } else {
                        const durationMs = currentEndTime.getTime() - currentStartTime.getTime()
                        newEndDateTime = new Date(startDateTime.getTime() + durationMs)
                      }
                    }

                    // Validate final end time
                    if (isNaN(newEndDateTime.getTime())) {
                      console.error('Invalid end date created')
                      return
                    }

                    setNewMeeting({
                      ...meeting,
                      start_time: startDateTime.toISOString(),
                      end_time: newEndDateTime.toISOString(),
                    })
                  } catch (error) {
                    console.error('Error updating start time:', error)
                  }
                }}
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
                required
              />
              <input
                type="time"
                value={typeof meeting.end_time === 'string' && meeting.end_time.includes('T')
                  ? new Date(meeting.end_time).toTimeString().slice(0, 5)
                  : meeting.end_time}
onChange={e => {
                  const newEndTime = e.target.value
                  
                  try {
                    // Get start time string for comparison
                    let startTimeString = meeting.start_time
                    if (typeof meeting.start_time === 'string' && meeting.start_time.includes('T')) {
                      const startDate = new Date(meeting.start_time)
                      if (!isNaN(startDate.getTime())) {
                        startTimeString = startDate.toTimeString().slice(0, 5)
                      } else {
                        console.error('Invalid start time for comparison:', meeting.start_time)
                        startTimeString = '00:00' // fallback
                      }
                    }
                    
                    // Parse times to determine if end time should be next day
                    const [startHour, startMinute] = startTimeString.split(':').map(Number)
                    const [endHour, endMinute] = newEndTime.split(':').map(Number)
                    
                    if (isNaN(startHour) || isNaN(startMinute) || isNaN(endHour) || isNaN(endMinute)) {
                      console.error('Invalid time parsing:', startTimeString, newEndTime)
                      return
                    }
                    
                    const startTotalMinutes = startHour * 60 + startMinute
                    const endTotalMinutes = endHour * 60 + endMinute
                    
                    // Check if end time should be next day
                    const shouldBeNextDay = 
                      // Case 1: Start time is PM (after 12:00) and end time is AM (before 12:00)
                      (startHour >= 12 && endHour < 12) ||
                      // Case 2: Both times are AM and before 4:00 AM, and end time is before start time
                      (startHour < 4 && endHour < 4 && endTotalMinutes < startTotalMinutes)
                    
                    // Create the full timestamp for end_time with validation
                    let endDateTime = new Date(meeting.date + 'T' + newEndTime + ':00')
                    
                    if (isNaN(endDateTime.getTime())) {
                      console.error('Invalid end date created:', meeting.date, newEndTime)
                      return
                    }
                    
                    if (shouldBeNextDay) {
                      // Add one day if end time is next day
                      endDateTime.setDate(endDateTime.getDate() + 1)
                      
                      // Validate date after modification
                      if (isNaN(endDateTime.getTime())) {
                        console.error('Invalid end date after adding day')
                        return
                      }
                    }
                    
                    setNewMeeting({ 
                      ...meeting, 
                      end_time: endDateTime.toISOString()
                    })
                  } catch (error) {
                    console.error('Error updating end time:', error)
                  }
                }}
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
                required
              />
            </div>

            <div className="flex gap-1">
              <select
                value={meeting.meeting_type}
                onChange={e =>
                  setNewMeeting({
                    ...meeting,
                    meeting_type: e.target.value as Meeting['meeting_type'],
                  })
                }
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
              >
                <option value="general">General</option>
                <option value="work">Work</option>
                <option value="personal">Personal</option>
                <option value="appointment">Appointment</option>
              </select>

              <select
                value={meeting.priority}
                onChange={e =>
                  setNewMeeting({
                    ...meeting,
                    priority: e.target.value as Meeting['priority'],
                  })
                }
                className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <select
                value={meeting.category_id || ''}
                onChange={e =>
                  setNewMeeting({
                    ...meeting,
                    category_id: e.target.value || undefined,
                  })
                }
                className="w-full px-1 py-1 border border-neutral-300 rounded-md text-xs"
              >
                <option value="">No category</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {(meeting.location || showLocationField) ? (
              <input
                type="text"
                placeholder="Location"
                value={meeting.location}
                onChange={e => setNewMeeting({ ...meeting, location: e.target.value })}
                className="w-full px-1 py-1 border border-neutral-300 rounded-md text-xs"
                autoFocus={showLocationField && !meeting.location}
              />
            ) : null}

            {(meeting.description || showDescriptionField) ? (
              <textarea
                placeholder="Description"
                value={meeting.description}
                onChange={e => setNewMeeting({ ...meeting, description: e.target.value })}
                className="w-full px-1 py-1 border border-neutral-300 rounded-md text-xs resize-none"
                rows={2}
                autoFocus={showDescriptionField && !meeting.description}
              />
            ) : null}

            {(!meeting.location && !showLocationField || !meeting.description && !showDescriptionField || (!editingMeeting && projects.length > 0)) && (
              <div className="flex gap-2">
                {!meeting.location && !showLocationField && (
                  <button type="button" onClick={() => setShowLocationField(true)} className="text-xs text-neutral-400 hover:text-neutral-600">
                    + Location
                  </button>
                )}
                {!meeting.description && !showDescriptionField && (
                  <button type="button" onClick={() => setShowDescriptionField(true)} className="text-xs text-neutral-400 hover:text-neutral-600">
                    + Description
                  </button>
                )}
                {!editingMeeting && projects.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivityProjectId('')
                      setActivityNote('')
                      setViewMode('project-activity')
                    }}
                    className="text-xs text-neutral-400 hover:text-neutral-600"
                  >
                    + Project activity
                  </button>
                )}
              </div>
            )}

            <div className="flex gap-1 justify-between pt-1">
              {editingMeeting && (
                <button
                  type="button"
                  onClick={handleDeleteMeeting}
                  className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                >
                  Delete
                </button>
              )}
              <div className="flex gap-1 ml-auto">
                <button
                  type="button"
                  onClick={closeMeetingModal}
                  className="px-2 py-1 text-neutral-600 text-xs hover:text-neutral-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700"
                >
                  {editingMeeting ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </form>
          )
        }
      </ModalWrapper>
    </>
  )
}

export default MeetingModal
