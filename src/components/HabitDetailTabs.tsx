import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, MessageSquare, Trash2, Archive, Plus, X, Target, FileText, Edit2, ArrowLeft, CheckCircle2, Circle, GripVertical, Pencil, RefreshCw } from 'lucide-react'
import HabitContext from './HabitContext'
import InlineEdit from './InlineEdit'
import { useHabits } from '../hooks/useHabits'
import { useHabitTypes } from '../hooks/useHabitTypes'
import { supabase } from '../lib/supabase'

interface HabitDetailTabsProps {
  habitId: string
  habitName: string
  initialTab?: 'subhabits' | 'settings'
  initialContext?: {
    background: string
    benefits: string
    consequences: string
  }
  onHabitDeleted?: () => void
  showBackButton?: boolean
  onBackClick?: () => void
  showCompletionToggle?: boolean
  onCompletionToggle?: () => void
  isCompleted?: boolean
}

const HabitDetailTabs: React.FC<HabitDetailTabsProps> = ({
  habitId,
  habitName,
  initialTab = 'settings',
  initialContext,
  onHabitDeleted,
  showBackButton = false,
  onBackClick,
  showCompletionToggle = false,
  onCompletionToggle,
  isCompleted = false,
}) => {
  const [activeTab, setActiveTab] = useState<'subhabits' | 'settings'>(initialTab)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [unsavedName, setUnsavedName] = useState<string | null>(null)
  const [unsavedStartTime, setUnsavedStartTime] = useState<string | null>(null)
  const [unsavedDuration, setUnsavedDuration] = useState<number | null>(null)
  const [unsavedWeeklyDays, setUnsavedWeeklyDays] = useState<string[] | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [subhabits, setSubhabits] = useState<any[]>([])
  const [aspects, setAspects] = useState<any[]>([])
  const [newSubhabitTitle, setNewSubhabitTitle] = useState('')
  const [newSubhabitMinutes, setNewSubhabitMinutes] = useState('')
  const [addingSubhabit, setAddingSubhabit] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [editingSubhabitId, setEditingSubhabitId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editMinutes, setEditMinutes] = useState('')
  const [aspectNotes, setAspectNotes] = useState<any[]>([])
  // Todoist import state
  const [todoistLabels, setTodoistLabels] = useState<string>('')
  const [todoistDefaultDuration, setTodoistDefaultDuration] = useState<number>(3)
  const [todoistTasks, setTodoistTasks] = useState<any[]>([])
  const [syncingTodoist, setSyncingTodoist] = useState(false)
  const [subhabitComments, setSubhabitComments] = useState<{[key: string]: string}>({})
  const [savingComments, setSavingComments] = useState<{[key: string]: boolean}>({})
  const commentTimeoutRefs = useRef<{[key: string]: NodeJS.Timeout}>({})
  const { habits, updateHabitType, updateHabitDuration, updateHabitName, updateHabitDefaultStartTime, updateHabitWeeklyDays, archiveHabit, unarchiveHabit, deleteHabit } = useHabits(undefined, { includeArchived: true })
  const { habitTypes } = useHabitTypes()
  
  const currentHabit = habits.find(h => h.id === habitId)
  const currentHabitType = currentHabit?.habits_types
  const navigate = useNavigate()

  // Fetch subhabits (now rows in cassian_habits with parent_habit_id set).
  // Alias the columns so the rest of this component can still read
  // sub.title / sub.duration_minutes without churn.
  const fetchSubhabits = async () => {
    try {
      const { data, error } = await supabase
        .from('cassian_habits')
        .select('id, title:name, duration_minutes:duration, sort_order, aspect_id, created_at, parent_habit_id')
        .eq('parent_habit_id', habitId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) throw error
      setSubhabits(data || [])
    } catch (err) {
      console.error('Error fetching subhabits:', err)
    }
  }

  const fetchAspects = async () => {
    try {
      const { data, error } = await supabase
        .from('cassian_aspects')
        .select('*')
        .order('title', { ascending: true })

      if (error) throw error
      setAspects(data || [])
    } catch (err) {
      console.error('Error fetching aspects:', err)
    }
  }

  // Fetch imported todoist tasks for this habit
  const fetchTodoistTasks = async () => {
    const { data } = await supabase
      .from('cassian_habit_todoist_tasks')
      .select('*')
      .eq('habit_id', habitId)
      .order('sort_order', { ascending: true })
    setTodoistTasks(data || [])
  }

  // Sync todoist tasks: pull from API, wipe & repopulate
  const syncTodoistTasks = async () => {
    if (!currentHabit?.todoist_filter_labels?.length) return
    setSyncingTodoist(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Call todoist edge function to get all tasks
      const { data: todoistData, error: fnError } = await supabase.functions.invoke('todoist', { body: { action: 'list_all' } })
      if (fnError || !todoistData?.tasks) return

      const labels = currentHabit.todoist_filter_labels
      const matchingTasks = todoistData.tasks.filter(
        (t: any) => t.labels?.some((l: string) => labels.includes(l))
      )

      // Get existing tasks to preserve overridden durations
      const { data: existing } = await supabase
        .from('cassian_habit_todoist_tasks')
        .select('todoist_task_id, duration_minutes')
        .eq('habit_id', habitId)
      const existingDurations = new Map(
        (existing || []).map((e: any) => [e.todoist_task_id, e.duration_minutes])
      )

      // Wipe existing
      await supabase.from('cassian_habit_todoist_tasks').delete().eq('habit_id', habitId)

      // Insert new
      if (matchingTasks.length > 0) {
        const defaultDuration = currentHabit.todoist_task_duration || 3
        const rows = matchingTasks.map((t: any, i: number) => ({
          habit_id: habitId,
          todoist_task_id: t.id,
          title: t.content,
          duration_minutes: existingDurations.get(t.id) || defaultDuration,
          sort_order: i + 1,
          user_id: user.id,
        }))
        await supabase.from('cassian_habit_todoist_tasks').insert(rows)
      }

      await fetchTodoistTasks()
    } catch (err) {
      console.error('Error syncing todoist tasks:', err)
    } finally {
      setSyncingTodoist(false)
    }
  }

  // Save todoist filter config on the habit
  const saveTodoistConfig = async () => {
    const labelsArray = todoistLabels.split(',').map(l => l.trim()).filter(Boolean)
    await supabase
      .from('cassian_habits')
      .update({
        todoist_filter_labels: labelsArray.length > 0 ? labelsArray : null,
        todoist_task_duration: todoistDefaultDuration,
      })
      .eq('id', habitId)
  }

  // Update duration of a single imported task
  const updateTodoistTaskDuration = async (taskId: string, duration: number) => {
    await supabase.from('cassian_habit_todoist_tasks').update({ duration_minutes: duration }).eq('id', taskId)
    setTodoistTasks(prev => prev.map(t => t.id === taskId ? { ...t, duration_minutes: duration } : t))
  }

  const fetchAspectNotes = async () => {
    try {
      // First, get the aspect IDs from this habit's subhabits
      const { data: habitSubhabits, error: subhabitsError } = await supabase
        .from('cassian_habits')
        .select('aspect_id')
        .eq('parent_habit_id', habitId)
        .not('aspect_id', 'is', null)

      if (subhabitsError) throw subhabitsError

      const aspectIds = habitSubhabits?.map(sh => sh.aspect_id).filter(Boolean) || []

      // If no aspects are associated with this habit's subhabits, show no notes
      if (aspectIds.length === 0) {
        setAspectNotes([])
        return
      }

      // Get notes that are connected to these aspects
      const { data: noteAspects, error: noteAspectsError } = await supabase
        .from('cassian_note_aspects')
        .select('note_id')
        .in('aspect_id', aspectIds)

      if (noteAspectsError) throw noteAspectsError

      const noteIds = noteAspects?.map(na => na.note_id) || []

      if (noteIds.length === 0) {
        setAspectNotes([])
        return
      }

      // Get the actual notes with their aspect information
      const { data: notes, error: notesError } = await supabase
        .from('cassian_notes')
        .select(`
          id,
          title,
          content,
          created_at,
          note_aspects:cassian_note_aspects!inner (
            aspects:cassian_aspects!inner (
              id,
              title
            )
          )
        `)
        .in('id', noteIds)
        .order('created_at', { ascending: false })

      if (notesError) throw notesError

      // Transform the data to include aspect information
      const transformedNotes = notes?.map(note => ({
        ...note,
        aspect_title: note.note_aspects?.[0]?.aspects?.title || 'Unknown'
      })) || []

      setAspectNotes(transformedNotes)
    } catch (err) {
      console.error('Error fetching aspect notes:', err)
      setAspectNotes([])
    }
  }

  // Fetch subhabit comments for today
  const fetchSubhabitComments = async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('cassian_subhabit_comments')
        .select('subhabit_id, comment')
        .eq('comment_date', today)
        .eq('user_id', user.id)
        .in('subhabit_id', subhabits.map(sh => sh.id))

      if (error) throw error

      const commentsMap = data?.reduce((acc: any, comment: any) => {
        acc[comment.subhabit_id] = comment.comment
        return acc
      }, {}) || {}

      setSubhabitComments(commentsMap)
    } catch (err) {
      console.error('Error fetching subhabit comments:', err)
    }
  }

  // Save or update subhabit comment
  const saveSubhabitComment = async (subhabitId: string, comment: string) => {
    setSavingComments(prev => ({ ...prev, [subhabitId]: true }))
    try {
      const today = new Date().toISOString().split('T')[0]
      
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        console.error('No authenticated user')
        return
      }
      
      const { error } = await supabase
        .from('cassian_subhabit_comments')
        .upsert({
          subhabit_id: subhabitId,
          user_id: user.id,
          comment: comment.trim(),
          comment_date: today
        }, {
          onConflict: 'subhabit_id,user_id,comment_date'
        })

      if (error) throw error

      setSubhabitComments(prev => ({
        ...prev,
        [subhabitId]: comment.trim()
      }))
    } catch (err) {
      console.error('Error saving subhabit comment:', err)
    } finally {
      setSavingComments(prev => ({ ...prev, [subhabitId]: false }))
    }
  }

  // Handle comment change with debounced auto-save
  const handleCommentChange = (subhabitId: string, comment: string) => {
    // Update state immediately for UI responsiveness
    setSubhabitComments(prev => ({
      ...prev,
      [subhabitId]: comment
    }))

    // Clear existing timeout for this subhabit
    if (commentTimeoutRefs.current[subhabitId]) {
      clearTimeout(commentTimeoutRefs.current[subhabitId])
    }

    // Set new timeout for autosave
    commentTimeoutRefs.current[subhabitId] = setTimeout(() => {
      if (comment.trim() !== '') {
        saveSubhabitComment(subhabitId, comment)
      }
    }, 1000) // 1 second delay like in notes
  }

  // Add new subhabit (inserts a child row into cassian_habits).
  const handleAddSubhabit = async () => {
    if (!newSubhabitTitle.trim() || !newSubhabitMinutes) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data, error } = await supabase
        .from('cassian_habits')
        .insert({
          parent_habit_id: habitId,
          user_id: user.id,
          name: newSubhabitTitle.trim(),
          duration: newSubhabitMinutes ? parseInt(newSubhabitMinutes) : 0,
          sort_order: subhabits.length + 1,
          is_visible: false,
          is_archived: false,
        })
        .select('id, title:name, duration_minutes:duration, sort_order, aspect_id, created_at, parent_habit_id')
        .single()

      if (error) throw error

      setSubhabits(prev => [...prev, data])
      setNewSubhabitTitle('')
      setNewSubhabitMinutes('')
      setAddingSubhabit(false)
    } catch (err) {
      console.error('Error adding subhabit:', err)
    }
  }

  // Reorder subhabits after drag-and-drop
  const handleReorder = async (fromIndex: number, toIndex: number) => {
    const reordered = [...subhabits]
    const [moved] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, moved)
    setSubhabits(reordered)

    // Persist new sort_order to DB
    const updates = reordered.map((sub, i) => ({ id: sub.id, sort_order: i + 1 }))
    for (const update of updates) {
      await supabase
        .from('cassian_habits')
        .update({ sort_order: update.sort_order })
        .eq('id', update.id)
    }
  }

  // Update subhabit
  const handleUpdateSubhabit = async (subhabitId: string) => {
    if (!editTitle.trim() || !editMinutes) return
    try {
      await supabase
        .from('cassian_habits')
        .update({ name: editTitle.trim(), duration: parseInt(editMinutes) })
        .eq('id', subhabitId)
      setSubhabits(prev => prev.map(s =>
        s.id === subhabitId ? { ...s, title: editTitle.trim(), duration_minutes: parseInt(editMinutes) } : s
      ))
      setEditingSubhabitId(null)
    } catch (err) {
      console.error('Error updating subhabit:', err)
    }
  }

  // Delete subhabit
  const handleDeleteSubhabit = async (subhabitId: string) => {
    if (!confirm('Delete this subhabit?')) return
    try {
      const { error } = await supabase
        .from('cassian_habits')
        .delete()
        .eq('id', subhabitId)

      if (error) throw error
      setSubhabits(prev => prev.filter(s => s.id !== subhabitId))
    } catch (err) {
      console.error('Error deleting subhabit:', err)
    }
  }

  useEffect(() => {
    fetchSubhabits()
    fetchAspects()
    fetchAspectNotes()
    fetchTodoistTasks()
  }, [habitId])

  // Load todoist config from habit
  useEffect(() => {
    if (currentHabit) {
      setTodoistLabels((currentHabit.todoist_filter_labels || []).join(', '))
      setTodoistDefaultDuration(currentHabit.todoist_task_duration || 3)
    }
  }, [currentHabit?.id])

  // Fetch comments after subhabits are loaded
  useEffect(() => {
    if (subhabits.length > 0) {
      fetchSubhabitComments()
    }
  }, [subhabits])

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(commentTimeoutRefs.current).forEach(timeout => {
        if (timeout) clearTimeout(timeout)
      })
    }
  }, [])

  const handleArchiveHabit = async () => {
    try {
      await archiveHabit(habitId)
      onHabitDeleted?.()
    } catch (error) {
      console.error('Error archiving habit:', error)
    }
  }

  const handleDeleteHabit = async () => {
    try {
      await deleteHabit(habitId)
      setShowDeleteConfirm(false)
      onHabitDeleted?.()
    } catch (error) {
      console.error('Error deleting habit:', error)
    }
  }


  const handleSaveSettings = async () => {
    setIsSaving(true)
    try {
      if (unsavedName !== null && unsavedName.trim() !== habitName) {
        await updateHabitName(habitId, unsavedName.trim())
        setUnsavedName(null)
      }
      if (unsavedStartTime !== null) {
        await updateHabitDefaultStartTime(habitId, unsavedStartTime)
        setUnsavedStartTime(null)
      }
      if (unsavedDuration !== null) {
        await updateHabitDuration(habitId, unsavedDuration)
        setUnsavedDuration(null)
      }
      if (unsavedWeeklyDays !== null) {
        await updateHabitWeeklyDays(habitId, unsavedWeeklyDays)
        setUnsavedWeeklyDays(null)
      }
    } catch (error) {
      console.error('Error saving settings:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const hasUnsavedChanges =
    unsavedName !== null ||
    unsavedStartTime !== null ||
    unsavedDuration !== null ||
    unsavedWeeklyDays !== null

  const tabs = [
    {
      key: 'settings' as const,
      label: 'Settings',
    },
    {
      key: 'subhabits' as const,
      label: 'Subhabits',
    },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Tab Navigation */}
      <div className="bg-gray-50 border-b border-gray-200 flex-shrink-0">
        <div className="flex grid grid-cols-2">
          {tabs.map(tab => {
            const isActive = activeTab === tab.key

            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1 px-2 py-1.5 text-sm font-medium transition-colors border-b-2 ${
                  isActive
                    ? 'bg-white text-blue-700 border-blue-500'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100 border-transparent'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'settings' && (
          <div className="h-full overflow-y-auto p-2">
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">Habit Name</label>
                <input
                  type="text"
                  value={unsavedName !== null ? unsavedName : (currentHabit?.name || habitName)}
                  onChange={e => setUnsavedName(e.target.value)}
                  className={`w-[250px] px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent ${
                    unsavedName !== null && unsavedName !== habitName ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'
                  }`}
                />
              </div>

              {/* Only show duration for calendar habits */}
              {currentHabit?.habits_types?.scheduling_rule !== 'non_calendar' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">Duration (minutes)</label>
                  <input
                    type="number"
                    value={unsavedDuration !== null ? unsavedDuration : (currentHabit?.duration || 0)}
                    onChange={e => {
                      const next = parseInt(e.target.value) || 0
                      setUnsavedDuration(next === (currentHabit?.duration || 0) ? null : next)
                    }}
                    className={`w-[250px] px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent ${
                      unsavedDuration !== null ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'
                    }`}
                    placeholder="Enter duration in minutes"
                    min="0"
                  />
                </div>
              )}

              {/* Only show default start time for calendar habits */}
              {currentHabit?.habits_types?.scheduling_rule !== 'non_calendar' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">Default Start Time</label>
                  <input
                    type="time"
                    value={unsavedStartTime !== null ? unsavedStartTime : (currentHabit?.default_start_time || '')}
                    onChange={e => setUnsavedStartTime(e.target.value)}
                    className={`w-[250px] px-2 py-1 border rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent ${
                      unsavedStartTime !== null ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'
                    }`}
                  />
                </div>
              )}


              {/* Weekly Days */}
              {currentHabit?.habits_types?.scheduling_rule !== 'non_calendar' && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Days (leave empty for daily)</label>
                  <div className="flex flex-wrap gap-1">
                    {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => {
                      const effectiveDays =
                        unsavedWeeklyDays !== null
                          ? unsavedWeeklyDays
                          : currentHabit?.weekly_days || []
                      const isActive = effectiveDays.includes(day)
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => {
                            const updated = isActive
                              ? effectiveDays.filter((d: string) => d !== day)
                              : [...effectiveDays, day]
                            const saved = currentHabit?.weekly_days || []
                            const sameAsSaved =
                              updated.length === saved.length &&
                              updated.every((d: string) => saved.includes(d))
                            setUnsavedWeeklyDays(sameAsSaved ? null : updated)
                          }}
                          className={`px-2 py-0.5 text-xs rounded transition-colors ${
                            isActive
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {day.slice(0, 3)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Save Button */}
              {hasUnsavedChanges && (
                <div className="pt-2">
                  <button
                    onClick={handleSaveSettings}
                    disabled={isSaving}
                    className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium"
                  >
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              )}

              {/* Archive Habit Section */}
              <div className="pt-2 border-t border-gray-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <h4 className="text-xs font-medium text-gray-700">
                      {currentHabit?.is_archived ? 'Unarchive' : 'Archive'}
                    </h4>
                    <p className="text-xs text-gray-600">
                      {currentHabit?.is_archived
                        ? 'Restore this habit so it shows up in your daily list again.'
                        : 'Archive this habit to hide it from your daily list. You can restore it later.'}
                    </p>
                  </div>
                  {currentHabit?.is_archived ? (
                    <button
                      onClick={async () => {
                        await unarchiveHabit(habitId)
                        onHabitDeleted?.()
                      }}
                      className="flex-shrink-0 px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors text-xs"
                    >
                      Unarchive Habit
                    </button>
                  ) : (
                    <button
                      onClick={handleArchiveHabit}
                      className="flex-shrink-0 px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors text-xs"
                    >
                      Archive Habit
                    </button>
                  )}
                </div>
              </div>

              {/* Delete Habit Section */}
              <div className="pt-2 border-t border-gray-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <h4 className="text-xs font-medium text-red-700">Danger Zone</h4>
                    <p className="text-xs text-gray-600">
                      Once you delete a habit, there is no going back. This will hide the habit and all its data.
                    </p>
                  </div>
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="flex-shrink-0 px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs"
                    >
                      Delete Habit
                    </button>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs text-red-800 font-medium">
                        Are you sure you want to delete "{habitName}"?
                      </p>
                      <div className="flex gap-1">
                        <button
                          onClick={handleDeleteHabit}
                          className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors text-xs"
                        >
                          Yes, Delete
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="px-2 py-1 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition-colors text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subhabits' && (
          <div className="h-full overflow-y-auto p-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-gray-700">Subhabits</h3>
                <button
                  onClick={() => setAddingSubhabit(true)}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  <Plus className="w-2 h-2" />
                  Add
                </button>
              </div>

              {/* Add new subhabit form */}
              {addingSubhabit && (
                <div className="p-2 border border-blue-200 rounded bg-blue-50 space-y-2">
                  <input
                    type="text"
                    placeholder="Subhabit title..."
                    value={newSubhabitTitle}
                    onChange={(e) => setNewSubhabitTitle(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    autoFocus
                  />
                  <input
                    type="number"
                    placeholder="Minutes"
                    value={newSubhabitMinutes}
                    onChange={(e) => setNewSubhabitMinutes(e.target.value)}
                    className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    min="1"
                    required
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={handleAddSubhabit}
                      className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingSubhabit(false)
                        setNewSubhabitTitle('')
                        setNewSubhabitMinutes('')
                      }}
                      className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Subhabits list */}
              <div className="space-y-1">
                {subhabits.length === 0 ? (
                  <p className="text-xs text-gray-500 py-4 text-center">
                    No subhabits yet. Add one to break down this habit into smaller actions.
                  </p>
                ) : (
                  subhabits.map((subhabit, index) => (
                    <div
                      key={subhabit.id}
                      draggable
                      onDragStart={() => setDragIndex(index)}
                      onDragOver={e => {
                        e.preventDefault()
                        setDragOverIndex(index)
                      }}
                      onDragEnd={() => {
                        if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
                          handleReorder(dragIndex, dragOverIndex)
                        }
                        setDragIndex(null)
                        setDragOverIndex(null)
                      }}
                      className={`px-2 py-1.5 border rounded bg-white cursor-grab active:cursor-grabbing transition-colors group ${
                        dragOverIndex === index ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {editingSubhabitId === subhabit.id ? (
                        <InlineEdit
                          fields={[
                            {
                              value: editTitle,
                              onChange: setEditTitle,
                              placeholder: 'Title',
                            },
                            {
                              value: editMinutes,
                              onChange: setEditMinutes,
                              placeholder: 'min',
                              type: 'number',
                              min: '1',
                              className: 'w-12 text-sm text-neutral-800 bg-transparent border-b border-primary-500 outline-none',
                            },
                          ]}
                          onSave={() => handleUpdateSubhabit(subhabit.id)}
                          onCancel={() => setEditingSubhabitId(null)}
                        />
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <GripVertical className="w-2.5 h-2.5 text-gray-400 flex-shrink-0" />
                            <div className="text-xs font-medium text-gray-900">
                              {subhabit.title}
                              {subhabit.duration_minutes && (
                                <span className="ml-1 text-gray-500 font-normal">{subhabit.duration_minutes}min</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button
                              onClick={() => {
                                setEditingSubhabitId(subhabit.id)
                                setEditTitle(subhabit.title)
                                setEditMinutes(String(subhabit.duration_minutes || ''))
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Edit subhabit"
                            >
                              <Pencil className="w-2 h-2" />
                            </button>
                            <button
                              onClick={() => handleDeleteSubhabit(subhabit.id)}
                              className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete subhabit"
                            >
                              <X className="w-2 h-2" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Todoist Import Section */}
              <div className="mt-4 pt-3 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-gray-700">Todoist Import</h3>
                  {currentHabit?.todoist_filter_labels?.length > 0 && (
                    <button
                      onClick={syncTodoistTasks}
                      disabled={syncingTodoist}
                      className="flex items-center gap-1 px-2 py-0.5 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                    >
                      <RefreshCw className={`w-2.5 h-2.5 ${syncingTodoist ? 'animate-spin' : ''}`} />
                      Sync
                    </button>
                  )}
                </div>

                {/* Config */}
                <div className="space-y-2 mb-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Labels (comma-separated)</label>
                    <input
                      type="text"
                      value={todoistLabels}
                      onChange={e => setTodoistLabels(e.target.value)}
                      onBlur={saveTodoistConfig}
                      placeholder="comms, waiting_for"
                      className="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Default duration (min)</label>
                    <input
                      type="number"
                      value={todoistDefaultDuration}
                      onChange={e => setTodoistDefaultDuration(parseInt(e.target.value) || 3)}
                      onBlur={saveTodoistConfig}
                      min="1"
                      className="w-20 px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Imported tasks list */}
                {todoistTasks.length > 0 && (
                  <div className="space-y-1">
                    {todoistTasks.map(task => (
                      <div key={task.id} className="flex items-center justify-between px-2 py-1 bg-amber-50 border border-amber-200 rounded text-xs">
                        <span className="text-gray-800 truncate flex-1">{task.title}</span>
                        <input
                          type="number"
                          value={task.duration_minutes}
                          onChange={e => updateTodoistTaskDuration(task.id, parseInt(e.target.value) || 1)}
                          min="1"
                          className="w-12 px-1 py-0.5 text-xs border border-amber-300 rounded text-center bg-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        <span className="text-gray-400 ml-0.5">min</span>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 mt-1">
                      {todoistTasks.reduce((sum: number, t: any) => sum + t.duration_minutes, 0)} min total
                    </p>
                  </div>
                )}

                {todoistTasks.length === 0 && currentHabit?.todoist_filter_labels?.length > 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">No imported tasks. Click Sync to pull from Todoist.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default HabitDetailTabs
