import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

export const fetchAllCalendarData = async (userId: string) => {
  
  
  // Add timeout wrapper for each query
  const withTimeout = <T>(promise: Promise<T>, ms: number = 5000): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error(`Query timeout after ${ms}ms`)), ms)
      )
    ])
  }

  try {
    // Fetch all data sources in parallel with timeout protection
    const [habitsResult, archivedHabitsWithLogsResult, archivedHabitsListResult, sessionsResult, projectsResult, meetingsResult, tasksDailyLogsResult, tasksResult, settingsResult, calendarNotesResult, habitNotesResult, categoryBuffersResult, projectActivityResult] = await Promise.allSettled([
      // Top-level habits only. Subhabits (parent_habit_id IS NOT NULL) are
      // fetched separately below and merged in — PostgREST can be fussy about
      // self-referencing embeds, so we avoid that hint here.
      withTimeout(supabase.from('cassian_habits').select('*, habits_daily_logs:cassian_habits_daily_logs(*), habits_types:cassian_habits_types(*), habit_todoist_tasks:cassian_habit_todoist_tasks(*)').eq('user_id', userId).eq('is_visible', true).is('parent_habit_id', null).or('is_archived.eq.false,is_archived.is.null')),
      // Archived habits stay on the calendar for any date that already has a
      // daily-log entry, so past completions don't disappear when a habit is
      // hidden. !inner returns only archived habits with at least one log.
      withTimeout(supabase.from('cassian_habits').select('*, habits_daily_logs:cassian_habits_daily_logs!inner(*), habits_types:cassian_habits_types(*), habit_todoist_tasks:cassian_habit_todoist_tasks(*)').eq('user_id', userId).eq('is_visible', true).is('parent_habit_id', null).eq('is_archived', true)),
      // Lightweight list of every archived top-level habit, used to populate
      // the "Archived" dropdown in the calendar top bar and the
      // archived-habits picker in MeetingModal.
      withTimeout(supabase.from('cassian_habits').select('id, name, duration, default_start_time, weekly_days').eq('user_id', userId).eq('is_visible', true).is('parent_habit_id', null).eq('is_archived', true).order('name')),
      withTimeout(supabase.from('cassian_sessions').select('*, projects:cassian_projects(*)').eq('user_id', userId)),
      withTimeout(supabase.from('cassian_projects').select('*').eq('user_id', userId).neq('status', 'archived')),
      withTimeout(supabase.from('cassian_meetings').select('*, meeting_habits:cassian_meeting_habits(habit_id)').eq('user_id', userId).or('is_ignored.is.null,is_ignored.eq.false')),
      withTimeout(supabase.from('cassian_tasks_daily_logs').select('*, tasks:cassian_tasks(*, projects:cassian_projects(*))').eq('user_id', userId)),
      withTimeout(supabase.from('cassian_tasks').select('*, projects:cassian_projects!inner(*)').eq('user_id', userId).neq('projects.status', 'archived')),
      withTimeout(supabase.from('cassian_user_settings').select('*').eq('user_id', userId).single()),
      withTimeout(supabase.from('cassian_calendar_notes').select('*, habits_notes:cassian_notes!calendar_notes_note_id_fkey(id, content, created_at)').order('pinned_date', { ascending: true })),
      // Only the fields the calendar actually uses — content/title for the
      // banner preview, start_date/start_time for grid indexing. Cap at 500
      // most-recent so users with years of notes don't pay to fetch them all.
      withTimeout(supabase.from('cassian_notes').select('id, user_id, title, content, start_date, start_time, created_at, updated_at').order('created_at', { ascending: false }).limit(500)),
      withTimeout(supabase.from('cassian_category_buffers').select('*, meeting_categories:cassian_meeting_categories(id, name, color)').eq('user_id', userId)),
      withTimeout(supabase.from('cassian_project_activity').select('*, projects:cassian_projects(*)').eq('user_id', userId))
    ])

    // Extract data with fallbacks
    const topLevelHabits = habitsResult.status === 'fulfilled' ? (habitsResult.value.data || []) : []
    const archivedWithLogs = archivedHabitsWithLogsResult.status === 'fulfilled' ? (archivedHabitsWithLogsResult.value.data || []) : []
    const archivedHabitsList = archivedHabitsListResult.status === 'fulfilled' ? (archivedHabitsListResult.value.data || []) : []
    const allTopLevel = [...topLevelHabits, ...archivedWithLogs]

    // Second-pass: pull subhabits (children of the habits we just fetched) and
    // attach them under `habit.subhabits` so downstream code sees the same shape
    // it did before the subhabits→habits merge.
    let habits = allTopLevel
    if (allTopLevel.length > 0) {
      const parentIds = allTopLevel.map((h: any) => h.id)
      const { data: subhabitRows } = await supabase
        .from('cassian_habits')
        .select('id, parent_habit_id, name, duration, sort_order, aspect_id, created_at, habits_daily_logs:cassian_habits_daily_logs(*)')
        .in('parent_habit_id', parentIds)
      const byParent = new Map<string, any[]>()
      for (const s of subhabitRows || []) {
        const arr = byParent.get(s.parent_habit_id) || []
        arr.push(s)
        byParent.set(s.parent_habit_id, arr)
      }
      habits = allTopLevel.map((h: any) => ({
        ...h,
        subhabits: byParent.get(h.id) || [],
      }))
    }
    const sessions = sessionsResult.status === 'fulfilled' ? (sessionsResult.value.data || []) : []
    const projects = projectsResult.status === 'fulfilled' ? (projectsResult.value.data || []) : []
    const meetings = meetingsResult.status === 'fulfilled' ? (meetingsResult.value.data || []) : []
    const tasksDailyLogs = tasksDailyLogsResult.status === 'fulfilled' ? (tasksDailyLogsResult.value.data || []) : []
    const tasks = tasksResult.status === 'fulfilled' ? (tasksResult.value.data || []) : []
    const settings = settingsResult.status === 'fulfilled' ? settingsResult.value.data : null
    const calendarNotes = calendarNotesResult.status === 'fulfilled' ? (calendarNotesResult.value.data || []) : []
    const habitNotes = habitNotesResult.status === 'fulfilled' ? (habitNotesResult.value.data || []) : []
    const categoryBuffers = categoryBuffersResult.status === 'fulfilled' ? (categoryBuffersResult.value.data || []) : []
    const projectActivity = projectActivityResult.status === 'fulfilled' ? (projectActivityResult.value.data || []) : []

    // Log any failures
    const failures = [
      habitsResult.status === 'rejected' && 'habits',
      sessionsResult.status === 'rejected' && 'sessions',
      projectsResult.status === 'rejected' && 'projects',
      meetingsResult.status === 'rejected' && 'meetings',
      tasksDailyLogsResult.status === 'rejected' && 'tasksDailyLogs',
      tasksResult.status === 'rejected' && 'tasks',
      settingsResult.status === 'rejected' && 'settings',
      calendarNotesResult.status === 'rejected' && 'calendarNotes',
      habitNotesResult.status === 'rejected' && 'habitNotes',
      categoryBuffersResult.status === 'rejected' && 'categoryBuffers',
      projectActivityResult.status === 'rejected' && 'projectActivity'
    ].filter(Boolean)
    
    if (failures.length > 0) {
      console.warn(`⚠️ Failed to fetch: ${failures.join(', ')}`)
    }

    

    return { habits, archivedHabitsList, sessions, projects, meetings, tasksDailyLogs, tasks, settings, calendarNotes, habitNotes, categoryBuffers, projectActivity }
  } catch (error) {
    console.error('Critical error fetching calendar data:', error)
    // Return minimal data to prevent complete failure
    return { habits: [], archivedHabitsList: [], sessions: [], projects: [], meetings: [], tasksDailyLogs: [], tasks: [], settings: null, calendarNotes: [], habitNotes: [], categoryBuffers: [], projectActivity: [] }
  }
}

export const fetchTasksForProjects = async (userId: string, projects: any[], sessions: any[]) => {
  
  
  if (projects.length === 0) return []

  // Hide ALL tasks from projects that have ANY sessions (past, present, or future)
  const projectsWithSessions = new Set(sessions.map(s => s.project_id))
  const projectsWithoutSessions = projects.filter(p => !projectsWithSessions.has(p.id))

  if (projectsWithoutSessions.length === 0) return []

  const activeProjects = projectsWithoutSessions.filter(p => p.status !== 'archived')
  if (activeProjects.length === 0) return []

  const projectIds = activeProjects.map(p => p.id)
  const tasksResult = await supabase
    .from('cassian_tasks')
    .select(`*, projects:cassian_projects!inner(*)`)
    .in('project_id', projectIds)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (tasksResult.error) {
    console.error('Error fetching tasks:', tasksResult.error)
    return []
  }

  const tasks = (tasksResult.data || []).map(task => ({
    ...task,
    project: task.projects
  }))

  
  return tasks
}