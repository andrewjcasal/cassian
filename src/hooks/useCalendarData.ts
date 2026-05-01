import { useState, useEffect, useMemo, useRef } from 'react'
import { format, addDays } from 'date-fns'
import { useTaskDailyLogs } from './useTaskDailyLogs'
import { useUserContext } from '../contexts/UserContext'
import { supabase } from '../lib/supabase'
import { fetchAllCalendarData, fetchTasksForProjects } from '../utils/calendarDataFetcher'
import { computeConflictMaps } from '../utils/calendarConflicts'
import { scheduleAllTasks, scheduleTaskInAvailableSlots } from '../utils/taskScheduling'
import { addMeeting as addMeetingUtil, updateMeeting as updateMeetingUtil, deleteMeeting as deleteMeetingUtil } from '../utils/meetingManager'
import { getEffectiveHabitStartTime } from '../utils/habitScheduling'
import { generateBuffersForDays, getBuffersForTimeSlot, BufferTime } from '../utils/bufferManager'
import { BufferBlock } from '../types'
import { startOfWeek } from 'date-fns'
import { calculateCategoryBufferBlocks } from '../utils/categoryBufferCalculation'
import { syncTodoistTasks } from '../utils/todoistSync'
import { syncClickUpTasks } from '../utils/clickupSync'
import { resolveHabitPlacements } from '../utils/habitPlacement'
import {
  GRID_START_HOUR,
  GRID_LAST_HOUR,
  GRID_START_CLOCK,
  GRID_START_MINUTES,
  isLateNightHour,
  hourToGridIndex,
  getColumnDate,
} from '../utils/calendarGrid'

// Todoist tasks are scheduled in personal hours, separate from work tasks
const TODOIST_WEEKDAY_HOURS = { start: 19, end: 23 }
const TODOIST_WEEKEND_HOURS = { start: 10, end: 23 }

// ClickUp tasks = work tasks; weekdays only (skip Sat/Sun entirely).
const CLICKUP_WORK_HOURS = { start: 11, end: 18 }

export const useCalendarData = (windowWidth: number, baseDate: Date = new Date(), hourHeight: number = 64, dayColumnCount: number = 7) => {
  const { user, loading: userLoading } = useUserContext()
  const [allTasks, setAllTasks] = useState<any[]>([])
  const [habits, setHabits] = useState<any[]>([])
  const [archivedHabits, setArchivedHabits] = useState<{
    id: string
    name: string
    duration: number | null
    default_start_time: string | null
    weekly_days: string[] | null
  }[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [meetings, setMeetings] = useState<any[]>([])
  const [tasksDailyLogs, setTasksDailyLogs] = useState<any[]>([])
  const [scheduledTasksCache, setScheduledTasksCache] = useState<Map<string, any[]>>(new Map())
  const [tasksScheduled, setTasksScheduled] = useState(false)
  const [buffers, setBuffers] = useState<Map<string, BufferTime>>(new Map())
  const [categoryBufferBlocks, setCategoryBufferBlocks] = useState<BufferBlock[]>([])
  const [settings, setSettings] = useState<any>(null)
  const [isInitializing, setIsInitializing] = useState(false)
  const initializingRef = useRef(false)
  const [lastFetchTime, setLastFetchTime] = useState<number>(0)

  // Category buffers state  
  const currentWeekStart = startOfWeek(baseDate, { weekStartsOn: 1 })
  
  const [dataHash, setDataHash] = useState('')
  const [calendarNotes, setCalendarNotes] = useState<any[]>([])
  const [habitNotes, setHabitNotes] = useState<any[]>([])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [isDataLoading, setIsDataLoading] = useState(true)
  const [conflictMaps, setConflictMaps] = useState({ 
    habitConflicts: new Map(), 
    sessionConflicts: new Map(), 
    meetingConflicts: new Map(),
    tasksDailyLogsConflicts: new Map(),
    bufferConflicts: new Map()
  })

  // getWorkHoursRange function using our local settings state
  const getWorkHoursRange = () => {
    if (!settings) {
      return { start: 10, end: 22 }
    }
    const start = parseInt(settings.work_hours_start.split(':')[0], 10)
    const end = parseInt(settings.work_hours_end.split(':')[0], 10)
    return { start, end }
  }
  const { saveTaskChunks } = useTaskDailyLogs()

  // Don't reset on date changes - keep cached tasks

  // Create data hash to detect when regeneration is needed
  const createDataHash = (habits: any[], sessions: any[], meetings: any[], tasks: any[], tasksDailyLogs: any[]) => {
    return [
      habits.map(h => `${h.id}-${h.current_start_time}-${h.duration}`).join('|'),
      sessions.map(s => `${s.id}-${s.scheduled_date}-${s.actual_start_time}-${s.scheduled_hours}`).join('|'),
      meetings.map(m => `${m.id}-${m.start_time}-${m.end_time}`).join('|'),
      tasks.map(t => `${t.id}-${t.estimated_hours}-${t.status}`).join('|'),
      tasksDailyLogs.map(l => `${l.id}-${l.log_date}-${l.scheduled_start_time}`).join('|')
    ].join('::')
  }

  // Load data once and cache tasks intelligently
  useEffect(() => {
    let cancelled = false

    const loadAndProcessAllCalendarData = async () => {
      // Prevent multiple simultaneous initializations
      if (initializingRef.current) return
      initializingRef.current = true

      setIsInitializing(true)
      setIsDataLoading(true)

      try {
        if (userLoading || !user) {
          setIsDataLoading(false)
          setIsInitializing(false)
          initializingRef.current = false
          return
        }

        // Step 1: Fetch all base data in parallel and update UI immediately
        const dataPromise = fetchAllCalendarData(user.id)
        const { habits: fetchedHabits, archivedHabitsList: fetchedArchivedHabits, sessions: fetchedSessions, projects: fetchedProjects, meetings: fetchedMeetings, tasksDailyLogs: fetchedTasksDailyLogs, tasks: fetchedTasks, settings: fetchedSettings, calendarNotes: fetchedCalendarNotes, habitNotes: fetchedHabitNotes, categoryBuffers: fetchedCategoryBuffers } = await dataPromise

        if (cancelled) return

        // Phase 1: Compute synchronous data and render grid immediately
        const today = new Date()
        const todayStr = format(today, 'yyyy-MM-dd')
        const filteredTasksDailyLogs = fetchedTasksDailyLogs.filter(log => log.log_date !== todayStr)
        const dayColumnsList = getDayColumns()
        const newConflictMaps = computeConflictMaps(fetchedHabits, fetchedSessions, fetchedMeetings, dayColumnsList, filteredTasksDailyLogs)
        const generatedBuffers = generateBuffersForDays(dayColumnsList, fetchedMeetings)

        if (cancelled) return
        setHabits(fetchedHabits)
        setArchivedHabits(fetchedArchivedHabits || [])
        setSessions(fetchedSessions)
        setProjects(fetchedProjects)
        setMeetings(fetchedMeetings)
        setTasksDailyLogs(fetchedTasksDailyLogs)
        setSettings(fetchedSettings)
        setCalendarNotes(fetchedCalendarNotes)
        setHabitNotes(fetchedHabitNotes)
        setConflictMaps(newConflictMaps)
        setIsDataLoading(false)

        // Phase 2: Task scheduling + buffers in parallel (background)
        const getWorkHoursRangeFromSettings = () => {
          if (!fetchedSettings) return { start: 10, end: 22 }
          const start = parseInt(fetchedSettings.work_hours_start.split(':')[0], 10)
          const end = parseInt(fetchedSettings.work_hours_end.split(':')[0], 10)
          return { start, end }
        }

        const [filteredTasks, calculatedBufferBlocks] = await Promise.all([
          fetchTasksForProjects(user.id, fetchedProjects, fetchedSessions),
          calculateCategoryBufferBlocks(user.id, baseDate, newConflictMaps, getWorkHoursRange, fetchedHabits, fetchedSettings, fetchedCategoryBuffers),
        ])

        if (cancelled) return
        setAllTasks(filteredTasks)
        setBuffers(generatedBuffers)
        setCategoryBufferBlocks(calculatedBufferBlocks)

        // Task scheduling
        const newDataHash = createDataHash(fetchedHabits, fetchedSessions, fetchedMeetings, filteredTasks, fetchedTasksDailyLogs)
        const needsRegeneration = !tasksScheduled || dataHash !== newDataHash

        if (needsRegeneration) {
          setDataHash(newDataHash)
          try {
            const scheduledResult = await scheduleAllTasks(
              filteredTasks,
              newConflictMaps,
              dayColumnsList,
              getWorkHoursRangeFromSettings,
              scheduleTaskInAvailableSlots,
              saveTaskChunks,
              user.id,
              filteredTasksDailyLogs,
              fetchedSettings?.weekend_days || ['saturday', 'sunday'],
              fetchedSettings,
              fetchedTasks,
              new Map()
            )
            if (cancelled) return
            setScheduledTasksCache(scheduledResult)
          } catch (error) {
            console.error('❌ Task scheduling failed:', error)
          }
        }
        setTasksScheduled(true)

      } catch (error) {
        console.error('Error in calendar data loading:', error)
        setIsDataLoading(false)
        // Set tasksScheduled to true to prevent infinite loading state
        setTasksScheduled(true)
      } finally {
        setIsInitializing(false)
        initializingRef.current = false
      }
    }

    // Only load if not already scheduled, or if explicitly reset
    if (!tasksScheduled && !userLoading && user) {
      loadAndProcessAllCalendarData()
    }

    return () => {
      cancelled = true
      initializingRef.current = false
    }
  }, [tasksScheduled, user?.id, userLoading])

  // Update current time every minute
  useEffect(() => {
    const updateTime = () => setCurrentTime(new Date())
    updateTime()
    const interval = setInterval(updateTime, 60000)
    return () => clearInterval(interval)
  }, [])

  // Memoize day columns calculation to avoid repeated date operations
  const dayColumns = useMemo(() => {
    const today = new Date()
    const todayStr = format(today, 'yyyy-MM-dd')
    const tomorrowStr = format(addDays(today, 1), 'yyyy-MM-dd')
    const yesterdayStr = format(addDays(today, -1), 'yyyy-MM-dd')

    const columnCount = windowWidth > 600 ? dayColumnCount : 1

    return Array.from({ length: columnCount }, (_, i) => {
      const date = addDays(baseDate, i)
      const dateStr = format(date, 'yyyy-MM-dd')

      let label: string
      if (dateStr === todayStr) {
        label = 'Today'
      } else if (dateStr === tomorrowStr) {
        label = 'Tomorrow'
      } else if (dateStr === yesterdayStr) {
        label = 'Yesterday'
      } else {
        label = columnCount === 1
          ? `${format(date, 'EEEEE')} ${date.getMonth() + 1}/${date.getDate()}`
          : format(date, 'EEE, MMM d')
      }

      return { date, label, dateStr }
    })
  }, [baseDate, windowWidth, dayColumnCount])


  const getDayColumns = () => {
    return dayColumns
  }

  const getHourSlots = () => {
    // Render one row per hour starting at GRID_START_HOUR, wrapping past
    // midnight through GRID_START_HOUR - 1 of the next day.
    const hours = []
    for (let step = 0; step < 24; step++) {
      const h = (GRID_START_HOUR + step) % 24
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
      const ampm = h >= 12 ? 'PM' : 'AM'
      hours.push({
        display: `${hour12}:00 ${ampm}`,
        time: `${h.toString().padStart(2, '0')}:00`,
      })
    }
    return hours
  }

  const getCurrentTimeLinePosition = (date: Date) => {
    const currentHour = currentTime.getHours()
    const currentMinute = currentTime.getMinutes()
    const isLateNight = isLateNightHour(currentHour)
    const todayStr = format(currentTime, 'yyyy-MM-dd')
    const dateStr = format(date, 'yyyy-MM-dd')

    // Late-night hours belong to the previous day's visual column.
    if (isLateNight) {
      const yesterday = new Date(currentTime)
      yesterday.setDate(yesterday.getDate() - 1)
      const yesterdayStr = format(yesterday, 'yyyy-MM-dd')
      if (dateStr !== yesterdayStr) return null
    } else {
      if (dateStr !== todayStr) return null
    }

    const hourIndex = hourToGridIndex(currentHour)
    const minutePercentage = currentMinute / 60
    return (hourIndex + minutePercentage) * hourHeight
  }

  // Meeting management functions
  const addMeeting = async (meetingData: any) => {
    const data = await addMeetingUtil(meetingData)
    setMeetings(prev => [...prev, data])
    
    // After adding meeting (especially past meetings with rollover), 
    // we need to refresh all affected data
    await refreshCalendarData()
    return data
  }

  const updateMeeting = async (id: string, meetingData: any) => {
    const data = await updateMeetingUtil(id, meetingData)
    setMeetings(prev => prev.map(m => m.id === id ? data : m))
    
    // After updating meeting, refresh data in case of rollover changes
    await refreshCalendarData()
    return data
  }

  const deleteMeeting = async (id: string) => {
    await deleteMeetingUtil(id)
    setMeetings(prev => prev.filter(m => m.id !== id))
    
    // After deleting meeting, refresh data
    await refreshCalendarData()  
  }

  // Helper function to refresh all calendar data after meeting changes
  const refreshCalendarData = async () => {
    try {
      if (!user) return

      // Re-fetch only tasks (task daily logs managed separately)
      const updatedTasks = await fetchTasksForProjects(user.id, projects, sessions)

      // Update state with fresh data
      setAllTasks(updatedTasks)

      // Recalculate conflict maps with updated meetings
      const today = new Date()
      const todayStr = format(today, 'yyyy-MM-dd')
      const filteredTasksDailyLogs = tasksDailyLogs.filter(log => log.log_date !== todayStr)
      const newConflictMaps = computeConflictMaps(habits, sessions, meetings, dayColumns, filteredTasksDailyLogs)
      setConflictMaps(newConflictMaps)

      // Regenerate category buffer blocks with updated conflict maps
      const calculatedBufferBlocks = await calculateCategoryBufferBlocks(user.id, baseDate, newConflictMaps, getWorkHoursRange, habits, settings)
      setCategoryBufferBlocks(calculatedBufferBlocks)
      
    } catch (error) {
      console.error('❌ Error refreshing calendar data:', error)
    }
  }



  // Trigger regeneration when data changes
  useEffect(() => {
    if (!tasksScheduled || !dataHash) return // Don't trigger on initial load
    
    const newDataHash = createDataHash(habits, sessions, meetings, allTasks, tasksDailyLogs)
    if (dataHash !== newDataHash) {
      
      
      // Trigger immediate regeneration
      const regenerateTasks = async () => {
        try {
          if (!user) return

          setDataHash(newDataHash)

          const today = new Date()
          const todayStr = format(today, 'yyyy-MM-dd')
          const filteredTasksDailyLogs = tasksDailyLogs.filter(log => log.log_date !== todayStr)
          
          // Recompute conflicts with new data (includes buffer conflicts)
          const newConflictMaps = computeConflictMaps(habits, sessions, meetings, dayColumns, filteredTasksDailyLogs)
          setConflictMaps(newConflictMaps)
          
          // Regenerate buffers with updated meetings
          const regeneratedBuffers = generateBuffersForDays(dayColumns, meetings)
          setBuffers(regeneratedBuffers)

          try {
            // Schedule tasks with new conflicts - use filtered data consistent with clearing
            const scheduledTasksResult = await scheduleAllTasks(
              allTasks,
              newConflictMaps,
              dayColumns,
              getWorkHoursRange,
              scheduleTaskInAvailableSlots,
              saveTaskChunks,
              user.id,
              filteredTasksDailyLogs,
              settings?.weekend_days || ['saturday', 'sunday'],
              settings,
              allTasks, // allTasks
              scheduledTasksCache // Pass existing scheduledTasksCache for regeneration
            )
            setScheduledTasksCache(scheduledTasksResult)
            
          } catch (error) {
            console.error('❌ Task regeneration failed:', error)
            // Continue with existing cache to avoid breaking the UI
          }
          
        } catch (error) {
          console.error('Error regenerating tasks:', error)
        }
      }
      
      regenerateTasks()
    }
  }, [habits, sessions, meetings, allTasks, tasksDailyLogs, dataHash, tasksScheduled, dayColumns, getWorkHoursRange, saveTaskChunks])

  // Get tasks for a specific time slot
  // --- Pre-indexed Maps for O(1) time slot lookups ---
  const EMPTY: any[] = []

  const tasksIndex = useMemo(() => {
    if (!tasksScheduled) return new Map<string, any[]>()
    const index = new Map<string, any[]>()
    scheduledTasksCache.forEach((chunks, dateKey) => {
      chunks.forEach(chunk => {
        const hour = chunk.startTime ? Math.floor(chunk.startTime) : chunk.startHour
        const key = `${dateKey}-${hour}`
        const arr = index.get(key) || []
        arr.push(chunk)
        index.set(key, arr)
      })
    })
    return index
  }, [scheduledTasksCache, tasksScheduled])

  const meetingsIndex = useMemo(() => {
    const index = new Map<string, any[]>()
    meetings.forEach(meeting => {
      const meetingStart = new Date(meeting.start_time)
      const meetingEnd = new Date(meeting.end_time)
      const startHour = meetingStart.getHours()
      const startMin = meetingStart.getMinutes()
      const startDateStr = format(meetingStart, 'yyyy-MM-dd')

      // Calculate total duration in hours
      const durationMs = meetingEnd.getTime() - meetingStart.getTime()
      const durationHours = durationMs / (1000 * 60 * 60)

      // Determine which hours this meeting spans
      const startTotalMin = startHour * 60 + startMin
      const endTotalMin = startTotalMin + durationHours * 60

      // Index at the start hour (primary entry)
      const key = `${getColumnDate(startDateStr, startHour)}-${startHour}`
      const arr = index.get(key) || []
      arr.push(meeting)
      index.set(key, arr)

      // Check if the meeting crosses the column split.
      // Late-night hours sit on the previous day's column; GRID_START_HOUR
      // onward is on the current day's column. A late-night meeting
      // extending past the split needs a clipped entry anchored at the
      // grid start in the current day's column.
      if (isLateNightHour(startHour) && endTotalMin > GRID_START_MINUTES) {
        const clippedMeeting = {
          ...meeting,
          _clippedStart: GRID_START_CLOCK,
          _originalStart: meeting.start_time,
        }
        const morningKey = `${startDateStr}-${GRID_START_HOUR}`
        const morningArr = index.get(morningKey) || []
        morningArr.push(clippedMeeting)
        index.set(morningKey, morningArr)
      }
    })
    return index
  }, [meetings])

  const getTasksForTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return tasksIndex.get(key) || EMPTY
  }

  const getMeetingsForTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return meetingsIndex.get(key) || EMPTY
  }

  // Resolve every habit occurrence's effective time window once, using the
  // shared placement algorithm. The render path indexes the results
  // per-hour-slot; the task-scheduler conflict map reads the same list so
  // both sides agree on where habits actually live on the calendar.
  const habitPlacements = useMemo(
    () => resolveHabitPlacements(habits, meetings, sessions, dayColumns),
    [habits, meetings, sessions, dayColumns]
  )

  const habitsIndex = useMemo(() => {
    const index = new Map<string, any[]>()
    // Quick lookup from habit id → source habit row so we can merge the
    // placement window back onto the full object the UI renders.
    const byId = new Map<string, any>(habits.map(h => [h.id, h]))
    for (const p of habitPlacements) {
      const habit = byId.get(p.habitId)
      if (!habit) continue
      if (p.end > GRID_LAST_HOUR && p.start > GRID_LAST_HOUR) continue
      const finalHour = Math.floor(p.start)
      const topPosition = (p.start - finalHour) * 100
      const key = `${p.dateKey}-${finalHour}`
      const arr = index.get(key) || []
      arr.push({ ...habit, topPosition, isRescheduled: p.isRescheduled })
      index.set(key, arr)
    }
    return index
  }, [habitPlacements, habits])

  const getHabitsForTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return habitsIndex.get(key) || EMPTY
  }

  // Get sessions for a specific time slot
  const sessionsIndex = useMemo(() => {
    const index = new Map<string, any[]>()
    const workHours = getWorkHoursRange()
    const defaultStartTime = `${workHours.start.toString().padStart(2, '0')}:00`
    sessions.forEach(session => {
      const dateStr = session.scheduled_date
      if (!dateStr) return
      const startTime = session.actual_start_time || defaultStartTime
      const hour = parseInt(startTime.split(':')[0])
      const minutes = parseInt(startTime.split(':')[1])
      const key = `${getColumnDate(dateStr, hour)}-${hour}`
      const arr = index.get(key) || []
      arr.push({ ...session, topPosition: (minutes / 60) * 100 })
      index.set(key, arr)
    })
    return index
  }, [sessions])

  const getSessionsForTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return sessionsIndex.get(key) || EMPTY
  }

  const tasksDailyLogsIndex = useMemo(() => {
    const index = new Map<string, any[]>()
    tasksDailyLogs.forEach(log => {
      const startTime = log.actual_start_time || log.scheduled_start_time
      if (!startTime) return
      const hour = parseInt(startTime.split(':')[0])
      const minutes = parseInt(startTime.split(':')[1])
      const key = `${getColumnDate(log.log_date, hour)}-${hour}`
      const arr = index.get(key) || []
      arr.push({ ...log, topPosition: (minutes / 60) * 100 })
      index.set(key, arr)
    })
    return index
  }, [tasksDailyLogs])

  const getTasksDailyLogsForTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return tasksDailyLogsIndex.get(key) || EMPTY
  }

  const buffersIndex = useMemo(() => {
    const generatedBuffers = generateBuffersForDays(dayColumns, meetings)
    const index = new Map<string, any[]>()
    generatedBuffers.forEach((buffer, dateStr) => {
      if (!buffer || !buffer.isActive) return
      const hour = parseInt(buffer.startTime.split(':')[0])
      const minutes = parseInt(buffer.startTime.split(':')[1])
      const key = `${dateStr}-${hour}`
      index.set(key, [{ ...buffer, topPosition: (minutes / 60) * 100 }])
    })
    return index
  }, [dayColumns, meetings])

  const categoryBuffersIndex = useMemo(() => {
    const index = new Map<string, any[]>()
    categoryBufferBlocks.forEach(block => {
      const blockStartHour = Math.floor(block.start_time)
      const blockEndHour = Math.ceil(block.start_time + block.duration)
      for (let hour = blockStartHour; hour < blockEndHour; hour++) {
        const key = `${block.dateStr}-${hour}`
        const arr = index.get(key) || []
        arr.push({ ...block, topPosition: ((block.start_time - hour) / 1) * 100 })
        index.set(key, arr)
      }
    })
    return index
  }, [categoryBufferBlocks])

  const getBuffersForCalendarTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return buffersIndex.get(key) || EMPTY
  }

  const getCategoryBuffersForTimeSlot = (timeSlot: string, date: Date) => {
    const key = `${format(date, 'yyyy-MM-dd')}-${parseInt(timeSlot.split(':')[0])}`
    return categoryBuffersIndex.get(key) || EMPTY
  }


  const hourSlots = useMemo(() => getHourSlots(), [])

  // Calendar notes helpers
  const getNotesForDateTime = (date: Date, time: string) => {
    const [hours, minutes] = time.split(':').map(Number)
    const targetDateTime = new Date(date)
    targetDateTime.setHours(hours, minutes, 0, 0)

    return calendarNotes.filter(note => {
      const pinnedDateTime = new Date(note.pinned_date)
      return Math.abs(pinnedDateTime.getTime() - targetDateTime.getTime()) < 60000
    })
  }

  const addCalendarNote = async (pinnedDate: string, noteId: string) => {
    const { data, error } = await supabase
      .from('cassian_calendar_notes')
      .insert({ pinned_date: pinnedDate, note_id: noteId })
      .select('*, habits_notes:cassian_notes!calendar_notes_note_id_fkey(id, content, created_at)')
      .single()
    if (error) throw error
    setCalendarNotes(prev => [...prev, data])
    return data
  }

  const addHabitNote = async (content: string, noteDate: string) => {
    const { data, error } = await supabase
      .from('cassian_notes')
      .insert({ content })
      .select()
      .single()
    if (error) throw error
    setHabitNotes(prev => [data, ...prev])
    return data
  }

  const removeCalendarNote = async (calendarNoteId: string) => {
    const { error } = await supabase
      .from('cassian_calendar_notes')
      .delete()
      .eq('id', calendarNoteId)
    if (error) throw error
    setCalendarNotes(prev => prev.filter(note => note.id !== calendarNoteId))
  }

  return {
    allTasks,
    scheduledTasksCache,
    tasksScheduled,
    baseDate,
    currentTime,
    habits,
    archivedHabits,
    conflictMaps,
    sessions,
    projects,
    meetings,
    tasksDailyLogs,
    isDataLoading,
    addMeeting,
    updateMeeting,
    deleteMeeting,
    dayColumns,
    hourSlots,
    getCurrentTimeLinePosition,
    getWorkHoursRange,
    getTasksForTimeSlot,
    getMeetingsForTimeSlot,
    getHabitsForTimeSlot,
    getSessionsForTimeSlot,
    syncTodoist: async (options?: { skipApi?: boolean; meetingsOverride?: any[] }) => {
      if (!user) return
      const skipApi = !!options?.skipApi
      let todoistApiTasks: any[] = []

      if (!skipApi) {
        // 1. Call Todoist API
        const { data: todoistData, error: fnError } = await supabase.functions.invoke('todoist', { body: { action: 'list_all' } })
        if (fnError || !todoistData?.tasks) return

        todoistApiTasks = todoistData.tasks

        // 2. Remove excluded tasks from DB (hold_off + habit-imported labels)
        const habitImportedLabels = habits
          .flatMap((h: any) => h.todoist_filter_labels || [])
        const excludedLabels = new Set(['hold_off', ...habitImportedLabels])

        const excludedTaskIds = todoistApiTasks
          .filter((t: any) => t.labels?.some((l: string) => excludedLabels.has(l)))
          .map((t: any) => t.id)

        if (excludedTaskIds.length > 0) {
          const { data: excludedDbTasks } = await supabase
            .from('cassian_tasks')
            .select('id')
            .in('todoist_task_id', excludedTaskIds)

          if (excludedDbTasks && excludedDbTasks.length > 0) {
            const dbIds = excludedDbTasks.map((t: any) => t.id)
            await supabase.from('cassian_tasks_daily_logs').delete().in('task_id', dbIds)
            await supabase.from('cassian_tasks').delete().in('id', dbIds)
          }
        }
        const tasksForScheduling = todoistApiTasks.filter(
          (t: any) => !t.labels?.some((l: string) => excludedLabels.has(l))
        )
        await syncTodoistTasks(tasksForScheduling, user.id)
      }

      // 4. Fetch all active todoist tasks from DB
      const { data: todoistDbTasks } = await supabase
        .from('cassian_tasks')
        .select('*')
        .eq('source', 'todoist')
        .eq('user_id', user.id)
        .eq('is_complete', false)

      if (!todoistDbTasks || todoistDbTasks.length === 0) return

      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const todoistDbIds = todoistDbTasks.map((t: any) => t.id)

      // 5. Delete ALL todoist daily logs from today onwards
      await supabase
        .from('cassian_tasks_daily_logs')
        .delete()
        .in('task_id', todoistDbIds)
        .gte('log_date', todayStr)

      // 6. Sort by priority: overdue/today > @urgent > rest
      const urgentTodoistIds = new Set(
        todoistApiTasks
          .filter((t: any) => t.labels?.includes('urgent'))
          .map((t: any) => t.id)
      )
      const urgentDbIds = new Set(
        todoistDbTasks
          .filter((t: any) => urgentTodoistIds.has(t.todoist_task_id))
          .map((t: any) => t.id)
      )

      const isUrgent = (t: any) => urgentDbIds.has(t.id)
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
      const byPriority = (a: any, b: any) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)

      // 7. Schedule in priority order with date pinning
      const futureDayColumns = dayColumns.filter((col: any) => col.dateStr >= todayStr)

      // Fetch daily logs fresh from the DB rather than trusting the in-memory
      // state — callers may have deleted a just-completed task's logs right
      // before calling syncTodoist, and React hasn't flushed the state update
      // yet. A stale log would phantom-block the freed slot.
      const { data: freshLogs } = await supabase
        .from('cassian_tasks_daily_logs')
        .select('*, tasks:cassian_tasks(*, projects:cassian_projects(*))')
        .eq('user_id', user.id)
      const nonTodoistDailyLogs = (freshLogs || []).filter(
        (log: any) => !todoistDbIds.includes(log.task_id)
      )
      // Use caller-supplied meetings if provided — e.g. a just-resized
      // meeting whose new end_time hasn't flushed into our `meetings`
      // state yet. Saves a round-trip when the caller already knows the
      // updated row locally.
      const meetingsForConflicts = options?.meetingsOverride ?? meetings
      const todoistConflictMaps = computeConflictMaps(habits, sessions, meetingsForConflicts, futureDayColumns, nonTodoistDailyLogs)
      const weekendDayNames = settings?.weekend_days || ['saturday', 'sunday']

      const getTodoistHoursForDate = (date?: Date) => {
        if (date) {
          const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
          if (weekendDayNames.includes(dayName)) return TODOIST_WEEKEND_HOURS
        }
        return TODOIST_WEEKDAY_HOURS
      }

      // Schedule per-day with correct priority ordering within each day:
      // 1. Overdue/today tasks
      // 2. Tasks whose due_date matches this day
      // 3. @urgent tasks
      // 4. Remaining by priority (high > med > low)
      const overdueOrToday = todoistDbTasks
        .filter((t: any) => t.due_date && t.due_date <= todayStr && !isUrgent(t))
        .sort(byPriority)
      const urgentTasks = todoistDbTasks
        .filter((t: any) => isUrgent(t) && !(t.due_date && t.due_date <= todayStr))
        .sort(byPriority)
      const restTasks = todoistDbTasks
        .filter((t: any) => !isUrgent(t) && !(t.due_date && t.due_date <= todayStr) && !t.due_date)
        .sort(byPriority)

      // Track which tasks have been scheduled (across all days)
      const scheduledTaskIds = new Set<string>()
      let combinedResult = new Map<string, any[]>()

      for (const dayCol of futureDayColumns) {
        // Dated tasks pinned to this specific day
        const datedForThisDay = todoistDbTasks
          .filter((t: any) => t.due_date && t.due_date > todayStr && t.due_date === dayCol.dateStr)
          .sort(byPriority)

        // Build per-day priority list, skipping already-scheduled tasks
        const dayTasks = [
          ...overdueOrToday.filter(t => !scheduledTaskIds.has(t.id)),
          ...datedForThisDay.filter(t => !scheduledTaskIds.has(t.id)),
          ...urgentTasks.filter(t => !scheduledTaskIds.has(t.id)),
          ...restTasks.filter(t => !scheduledTaskIds.has(t.id)),
        ]
        if (dayTasks.length === 0) continue

        const dayResult = await scheduleAllTasks(
          dayTasks, todoistConflictMaps, [dayCol], getTodoistHoursForDate,
          scheduleTaskInAvailableSlots, saveTaskChunks,
          user.id, nonTodoistDailyLogs, [], null, dayTasks, new Map()
        )

        dayResult.forEach((tasks, dateKey) => {
          tasks.forEach((t: any) => {
            const taskId = t.id?.split('-chunk-')[0]
            if (taskId) scheduledTaskIds.add(taskId)
          })
          const existing = combinedResult.get(dateKey) || []
          combinedResult.set(dateKey, [...existing, ...tasks])
        })
      }

      const todoistScheduleResult = combinedResult
      // 8. Update UI state
      setScheduledTasksCache(prev => {
        const merged = new Map(prev)
        todoistScheduleResult.forEach((tasks, dateKey) => {
          const existing = merged.get(dateKey) || []
          const existingIds = new Set(existing.map((t: any) => t.id))
          const newTasks = tasks.filter((t: any) => !existingIds.has(t.id))
          if (newTasks.length > 0) merged.set(dateKey, [...existing, ...newTasks])
        })
        return merged
      })

      // 9. Re-fetch daily logs to update UI
      const { data: refreshedLogs } = await supabase
        .from('cassian_tasks_daily_logs')
        .select('*, tasks:cassian_tasks(*, projects:cassian_projects(*))')
        .eq('user_id', user.id)

      if (refreshedLogs) {
        setTasksDailyLogs(refreshedLogs)
      }
    },
    syncClickUp: async (options?: { skipApi?: boolean; meetingsOverride?: any[] }) => {
      if (!user) return
      const skipApi = !!options?.skipApi

      if (!skipApi) {
        // 1. Pull all open tasks assigned to the current user from ClickUp.
        const { data: clickupData, error: fnError } = await supabase.functions.invoke('clickup', {
          body: { action: 'list_all' },
        })
        if (fnError || !clickupData?.tasks) return

        const clickupApiTasks = clickupData.tasks as any[]

        // 2. Reconcile into cassian_tasks (insert/update/close).
        await syncClickUpTasks(clickupApiTasks, user.id)
      }

      // 3. Fetch all active clickup tasks from DB.
      const { data: clickupDbTasks } = await supabase
        .from('cassian_tasks')
        .select('*')
        .eq('source', 'clickup')
        .eq('user_id', user.id)
        .eq('is_complete', false)

      if (!clickupDbTasks || clickupDbTasks.length === 0) return

      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const clickupDbIds = clickupDbTasks.map((t: any) => t.id)

      // 4. Clear future clickup daily logs — we'll regenerate them below.
      await supabase
        .from('cassian_tasks_daily_logs')
        .delete()
        .in('task_id', clickupDbIds)
        .gte('log_date', todayStr)

      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
      const byPriority = (a: any, b: any) =>
        (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)

      // 5. Weekday-only columns from today forward.
      const weekendDayNames = settings?.weekend_days || ['saturday', 'sunday']
      const isWeekday = (date: Date) => {
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
        return !weekendDayNames.includes(dayName)
      }
      const futureWorkdayColumns = dayColumns.filter(
        (col: any) => col.dateStr >= todayStr && isWeekday(col.date)
      )

      // Pull daily logs fresh from the DB — callers may have deleted a
      // just-completed task's logs immediately before invoking this
      // function and React hasn't flushed the state update yet.
      const { data: freshLogs } = await supabase
        .from('cassian_tasks_daily_logs')
        .select('*, tasks:cassian_tasks(*, projects:cassian_projects(*))')
        .eq('user_id', user.id)
      const nonAutoDailyLogs = (freshLogs || []).filter(
        (log: any) => !clickupDbIds.includes(log.task_id)
      )
      const meetingsForConflicts = options?.meetingsOverride ?? meetings
      const clickupConflictMaps = computeConflictMaps(
        habits, sessions, meetingsForConflicts, futureWorkdayColumns, nonAutoDailyLogs
      )

      const getClickUpHours = () => CLICKUP_WORK_HOURS

      const overdueOrToday = clickupDbTasks
        .filter((t: any) => t.due_date && t.due_date <= todayStr)
        .sort(byPriority)
      const restTasks = clickupDbTasks
        .filter((t: any) => !(t.due_date && t.due_date <= todayStr) && !t.due_date)
        .sort(byPriority)

      const scheduledTaskIds = new Set<string>()
      const combinedResult = new Map<string, any[]>()

      for (const dayCol of futureWorkdayColumns) {
        const datedForThisDay = clickupDbTasks
          .filter((t: any) => t.due_date && t.due_date > todayStr && t.due_date === dayCol.dateStr)
          .sort(byPriority)

        const dayTasks = [
          ...overdueOrToday.filter(t => !scheduledTaskIds.has(t.id)),
          ...datedForThisDay.filter(t => !scheduledTaskIds.has(t.id)),
          ...restTasks.filter(t => !scheduledTaskIds.has(t.id)),
        ]
        if (dayTasks.length === 0) continue

        const dayResult = await scheduleAllTasks(
          dayTasks, clickupConflictMaps, [dayCol], getClickUpHours,
          scheduleTaskInAvailableSlots, saveTaskChunks,
          user.id, nonAutoDailyLogs, [], null, dayTasks, new Map()
        )

        dayResult.forEach((tasks, dateKey) => {
          tasks.forEach((t: any) => {
            const taskId = t.id?.split('-chunk-')[0]
            if (taskId) scheduledTaskIds.add(taskId)
          })
          const existing = combinedResult.get(dateKey) || []
          combinedResult.set(dateKey, [...existing, ...tasks])
        })
      }

      // 6. Update UI cache.
      setScheduledTasksCache(prev => {
        const merged = new Map(prev)
        combinedResult.forEach((tasks, dateKey) => {
          const existing = merged.get(dateKey) || []
          const existingIds = new Set(existing.map((t: any) => t.id))
          const newTasks = tasks.filter((t: any) => !existingIds.has(t.id))
          if (newTasks.length > 0) merged.set(dateKey, [...existing, ...newTasks])
        })
        return merged
      })

      // 7. Refresh task logs for render.
      const { data: refreshedLogs } = await supabase
        .from('cassian_tasks_daily_logs')
        .select('*, tasks:cassian_tasks(*, projects:cassian_projects(*))')
        .eq('user_id', user.id)

      if (refreshedLogs) {
        setTasksDailyLogs(refreshedLogs)
      }
    },
    getTasksDailyLogsForTimeSlot,
    getBuffersForCalendarTimeSlot,
    getCategoryBuffersForTimeSlot,
    buffers,
    categoryBufferBlocks,
    settings,
    calendarNotes,
    habitNotes,
    setHabitNotes,
    getNotesForDateTime,
    addCalendarNote,
    addHabitNote,
    removeCalendarNote,
    skipHabitForDate: (habitId: string, date: string) => {
      setHabits(prev => prev.map(h => {
        if (h.id !== habitId) return h
        const existingLogs = h.habits_daily_logs || []
        const hasLog = existingLogs.some((log: any) => log.log_date === date)
        return {
          ...h,
          habits_daily_logs: hasLog
            ? existingLogs.map((log: any) => log.log_date === date ? { ...log, is_skipped: true } : log)
            : [...existingLogs, { habit_id: habitId, log_date: date, is_skipped: true }]
        }
      }))
    },
    linkMeetingHabit: (meetingId: string, habitId: string) => {
      setMeetings(prev => prev.map(m => {
        if (m.id !== meetingId) return m
        const existing = m.meeting_habits || []
        return { ...m, meeting_habits: [...existing, { habit_id: habitId }] }
      }))
    },
    moveHabitLog: (habitId: string, date: string, newStartTime: string) => {
      setHabits(prev => prev.map(h => {
        if (h.id !== habitId) return h
        const logs = h.habits_daily_logs || []
        const hasLog = logs.some((log: any) => log.log_date === date && !log.is_skipped)
        if (hasLog) {
          return {
            ...h,
            habits_daily_logs: logs.map((log: any) =>
              log.log_date === date && !log.is_skipped ? { ...log, scheduled_start_time: newStartTime } : log
            )
          }
        }
        // No existing log — add one
        return {
          ...h,
          habits_daily_logs: [...logs, { habit_id: habitId, log_date: date, scheduled_start_time: newStartTime, is_skipped: false, duration: h.duration }]
        }
      }))
    },
    updateHabitLogDuration: (habitId: string, date: string, duration: number) => {
      setHabits(prev => prev.map(h => {
        if (h.id !== habitId) return h
        const logs = (h.habits_daily_logs || []).map((log: any) =>
          log.log_date === date && !log.is_skipped ? { ...log, duration } : log
        )
        return { ...h, habits_daily_logs: logs }
      }))
    },
    addHabitBlock: (habitId: string, date: string, startTime: string, duration: number) => {
      setHabits(prev => prev.map(h => {
        if (h.id !== habitId) return h
        // Remove skipped logs for this date, add new block
        const existingLogs = (h.habits_daily_logs || []).filter(
          (log: any) => !(log.log_date === date && log.is_skipped)
        )
        return {
          ...h,
          habits_daily_logs: [
            ...existingLogs,
            { habit_id: habitId, log_date: date, scheduled_start_time: startTime, duration, is_skipped: false, is_completed: false }
          ]
        }
      }))
    },
    removeTaskLogFromUI: (logId: string) => {
      setTasksDailyLogs(prev => prev.filter(log => log.id !== logId))
    },
    moveTaskLog: (logId: string, newStartTime: string, newEndTime: string) => {
      setTasksDailyLogs(prev => prev.map(log =>
        log.id === logId ? { ...log, scheduled_start_time: newStartTime, scheduled_end_time: newEndTime } : log
      ))
    },
    removeTaskFromCalendar: (taskId: string) => {
      setTasksDailyLogs(prev => prev.filter(log => log.task_id !== taskId))
      setScheduledTasksCache(prev => {
        const updated = new Map(prev)
        updated.forEach((chunks, dateKey) => {
          const filtered = chunks.filter((c: any) => !c.id?.startsWith(taskId))
          if (filtered.length !== chunks.length) updated.set(dateKey, filtered)
        })
        return updated
      })
    },
    setAllTasks,
    setScheduledTasksCache,
    setTasksScheduled,
    // Push a newly-created habit (returned from the insert) into local state
    // so the calendar renders it without a refetch.
    addHabit: (habit: any) => {
      setHabits(prev => [
        ...prev,
        { ...habit, habits_daily_logs: [], subhabits: [], habit_todoist_tasks: [] },
      ])
    },
    // Mark a habit as archived in local state so habitPlacement stops
    // scheduling new occurrences (past dates with logs still render).
    markHabitArchived: (habitId: string) => {
      let archived:
        | { id: string; name: string; duration: number | null; default_start_time: string | null; weekly_days: string[] | null }
        | null = null
      setHabits(prev => prev.map(h => {
        if (h.id !== habitId) return h
        archived = {
          id: h.id,
          name: h.name,
          duration: h.duration ?? null,
          default_start_time: h.default_start_time ?? null,
          weekly_days: h.weekly_days ?? null,
        }
        return { ...h, is_archived: true }
      }))
      if (archived) {
        setArchivedHabits(prev =>
          prev.some(h => h.id === archived!.id)
            ? prev
            : [...prev, archived!].sort((a, b) => a.name.localeCompare(b.name))
        )
      }
    },
    // Unarchive a habit: persist the schedule update, drop it from the
    // archived list, and patch the habit in local state so the calendar
    // reflects the change without a page reload.
    unarchiveHabit: async (
      habitId: string,
      updates: { duration: number; default_start_time: string; weekly_days: string[] | null }
    ) => {
      if (!user) return
      const { error } = await supabase
        .from('cassian_habits')
        .update({
          is_archived: false,
          duration: updates.duration,
          default_start_time: updates.default_start_time,
          current_start_time: updates.default_start_time,
          weekly_days: updates.weekly_days,
        })
        .eq('id', habitId)
        .eq('user_id', user.id)
      if (error) throw error

      const archivedRow = archivedHabits.find(h => h.id === habitId)
      setArchivedHabits(prev => prev.filter(h => h.id !== habitId))
      setHabits(prev => {
        const existing = prev.find(h => h.id === habitId)
        if (existing) {
          return prev.map(h =>
            h.id === habitId
              ? {
                  ...h,
                  is_archived: false,
                  duration: updates.duration,
                  default_start_time: updates.default_start_time,
                  current_start_time: updates.default_start_time,
                  weekly_days: updates.weekly_days,
                }
              : h
          )
        }
        if (!archivedRow) return prev
        return [
          ...prev,
          {
            id: archivedRow.id,
            name: archivedRow.name,
            is_archived: false,
            duration: updates.duration,
            default_start_time: updates.default_start_time,
            current_start_time: updates.default_start_time,
            weekly_days: updates.weekly_days,
            habits_daily_logs: [],
            subhabits: [],
            habit_todoist_tasks: [],
          },
        ]
      })
    },
  }
}
