import { useState, useEffect } from 'react'
import { supabase, Habit, HabitDailyLog, HabitWithType } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useReflections } from './useReflections'

export function useHabits(selectedDate?: string, options?: { includeArchived?: boolean }) {
  const { user } = useAuth()
  const { generateReflection, getTodaysReflection } = useReflections()
  const [habits, setHabits] = useState<HabitWithType[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sleepStartTime, setSleepStartTime] = useState<string | null>(null)

  const fetchHabits = async (cancelled?: () => boolean) => {
    if (!user) return

    try {
      setLoading(true)
      setError(null)

      // Get the most recent sleep log (with start_time and end_time for reset logic)
      const { data: recentSleep } = await supabase
        .from('cassian_habits_time_logs')
        .select('start_time, end_time')
        .eq('user_id', user.id)
        .eq('activity_type_id', '951bc26a-a863-4996-8a02-f4da2d148aa9') // sleep activity type
        .order('start_time', { ascending: false })
        .limit(1)
        .single()

      if (cancelled?.()) return

      // Check if we should auto-uncheck habits based on sleep start time
      // Reuse the sleep data we already fetched
      await checkAndResetHabitsAfterSleep(recentSleep)

      if (cancelled?.()) return

      let currentSleepStartTime: string | null = null
      if (recentSleep?.start_time) {
        const sleepDate = new Date(recentSleep.start_time)
        currentSleepStartTime = sleepDate.toTimeString().split(' ')[0] // Get HH:MM:SS format
      }

      setSleepStartTime(currentSleepStartTime)

      // Build the query - show all habits and include recent daily logs for pull-back calculation
      let query = supabase
        .from('cassian_habits')
        .select(
          `
          *,
          habits_types:cassian_habits_types (*),
          habits_daily_logs:cassian_habits_daily_logs (
            *
          )
        `
        )
        .or(`user_id.eq.${user.id},user_id.is.null`)
        .eq('is_visible', true)
        // Include logs from the last 30 days for pull-back calculations
        .gte('habits_daily_logs.log_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])

      if (!options?.includeArchived) {
        query = query.or('is_archived.eq.false,is_archived.is.null')
      }

      const { data, error } = await query.order('current_start_time', { ascending: true })

      if (cancelled?.()) return

      if (error) throw error

      setHabits(data || [])
    } catch (err) {
      console.error('Error fetching habits:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const logHabitCompletion = async (
    habitId: string,
    isCompleted: boolean,
    actualStartTime?: string,
    actualEndTime?: string,
    notes?: string
  ) => {
    if (!user) return

    try {
      const logDate = selectedDate || new Date().toISOString().split('T')[0]
      const habit = habits.find(h => h.id === habitId)

      const logData = {
        habit_id: habitId,
        user_id: user.id,
        log_date: logDate,
        scheduled_start_time: habit?.current_start_time,
        actual_start_time: actualStartTime,
        actual_end_time: actualEndTime,
        is_completed: isCompleted,
        notes: notes,
      }

      const { error } = await supabase.from('cassian_habits_daily_logs').upsert(logData, {
        onConflict: 'habit_id,user_id,log_date,scheduled_start_time',
      })

      if (error) throw error

      // Update local state
      setHabits(prevHabits =>
        prevHabits.map(habit => {
          if (habit.id === habitId) {
            const existingLog = habit.habits_daily_logs?.[0]
            const updatedLog = {
              ...existingLog,
              ...logData,
              id: existingLog?.id || '',
              created_at: existingLog?.created_at || new Date().toISOString(),
            }

            return {
              ...habit,
              habits_daily_logs: [updatedLog],
            }
          }
          return habit
        })
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log habit')
    }
  }

  const updateHabitStartTime = async (habitId: string, newTime: string) => {
    if (!user) return

    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ current_start_time: newTime })
        .eq('id', habitId)
        .eq('user_id', user.id)

      if (error) throw error

      // Update local state
      setHabits(prevHabits =>
        prevHabits.map(habit =>
          habit.id === habitId ? { ...habit, current_start_time: newTime } : habit
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update habit time')
    }
  }

  const updateHabitType = async (habitId: string, habitTypeId: string) => {
    if (!user) return

    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ habit_type_id: habitTypeId })
        .eq('id', habitId)
        .eq('user_id', user.id)

      if (error) throw error

      // Refresh habits to get updated type information
      await fetchHabits()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update habit type')
    }
  }

  const updateHabitDuration = async (habitId: string, newDuration: number) => {
    if (!user) return

    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ duration: newDuration })
        .eq('id', habitId)
        .eq('user_id', user.id)

      if (error) throw error

      // Update local state
      setHabits(prevHabits =>
        prevHabits.map(habit =>
          habit.id === habitId ? { ...habit, duration: newDuration } : habit
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update habit duration')
    }
  }

  const updateHabitName = async (habitId: string, newName: string) => {
    if (!user) return
    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ name: newName })
        .eq('id', habitId)
        .eq('user_id', user.id)
      if (error) throw error
      // Update local state
      setHabits(prevHabits =>
        prevHabits.map(habit =>
          habit.id === habitId ? { ...habit, name: newName } : habit
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update habit name')
    }
  }

  const updateHabitDefaultStartTime = async (habitId: string, newStartTime: string) => {
    if (!user) return
    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ 
          default_start_time: newStartTime,
          current_start_time: newStartTime 
        })
        .eq('id', habitId)
        .eq('user_id', user.id)
      if (error) throw error
      // Update local state
      setHabits(prevHabits =>
        prevHabits.map(habit =>
          habit.id === habitId ? { 
            ...habit, 
            default_start_time: newStartTime,
            current_start_time: newStartTime 
          } : habit
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update habit start time')
    }
  }

  const updateHabitWeeklyDays = async (habitId: string, weeklyDays: string[]) => {
    if (!user) return
    try {
      const value = weeklyDays.length > 0 ? weeklyDays : null
      const { error } = await supabase
        .from('cassian_habits')
        .update({ weekly_days: value })
        .eq('id', habitId)
        .eq('user_id', user.id)
      if (error) throw error
      setHabits(prevHabits =>
        prevHabits.map(habit =>
          habit.id === habitId ? { ...habit, weekly_days: value } : habit
        )
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update weekly days')
    }
  }

  const archiveHabit = async (habitId: string) => {
    if (!user) return

    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ is_archived: true })
        .eq('id', habitId)
        .eq('user_id', user.id)

      if (error) throw error

      // Remove from local state
      setHabits(prevHabits => prevHabits.filter(habit => habit.id !== habitId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive habit')
      throw err
    }
  }

  const unarchiveHabit = async (habitId: string) => {
    if (!user) return
    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ is_archived: false })
        .eq('id', habitId)
        .eq('user_id', user.id)
      if (error) throw error
      // Refetch so the newly-unarchived habit reappears in the main list.
      await fetchHabits()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive habit')
      throw err
    }
  }

  const deleteHabit = async (habitId: string) => {
    if (!user) return

    try {
      const { error } = await supabase
        .from('cassian_habits')
        .update({ is_visible: false })
        .eq('id', habitId)
        .eq('user_id', user.id)

      if (error) throw error

      // Remove from local state
      setHabits(prevHabits => prevHabits.filter(habit => habit.id !== habitId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete habit')
      throw err
    }
  }

  const createHabit = async (habitData: {
    name: string
    duration: number
    habit_type_id: string
    default_start_time?: string
    background: string
    benefits: string
    consequences: string
    weekly_days?: string[] | null
  }) => {
    if (!user) return

    try {
      const insertData: any = {
        name: habitData.name,
        user_id: user.id,
        duration: habitData.duration,
        habit_type_id: habitData.habit_type_id,
        background: habitData.background,
        benefits: habitData.benefits,
        consequences: habitData.consequences,
        is_visible: true,
      }

      // Only add start time fields for calendar habits
      if (habitData.default_start_time) {
        insertData.default_start_time = habitData.default_start_time
        insertData.current_start_time = habitData.default_start_time
      }

      if (habitData.weekly_days && habitData.weekly_days.length > 0) {
        insertData.weekly_days = habitData.weekly_days
      }

      const { data, error } = await supabase
        .from('cassian_habits')
        .insert(insertData)
        .select('*, habits_types:cassian_habits_types(*)')
        .single()

      if (error) throw error

      // Refresh habits to show the new habit
      await fetchHabits()

      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create habit')
      throw err
    }
  }

  const updateHabitStartTimes = async () => {
    if (!user) return

    try {
      const { error } = await supabase.rpc('update_habit_start_times', {
        p_user_id: user.id,
      })

      if (error) throw error

      // Refresh habits to get updated times
      await fetchHabits()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update habit times')
    }
  }

  const checkAndResetHabitsAfterSleep = async (sleepLog: { start_time: string; end_time: string | null } | null) => {
    if (!user) return

    try {
      const today = new Date().toISOString().split('T')[0]

      // Only reset if we found a sleep log AND it has ended (indicating wake up)
      if (!sleepLog || !sleepLog.end_time) {

        return
      }

      const sleepStartTime = new Date(sleepLog.start_time)
      const sleepEndTime = new Date(sleepLog.end_time)
      const now = new Date()

      

      // Only reset habits if we've woken up from sleep (past end_time)
      // AND the sleep was from today (started after midnight today)
      const todayStart = new Date(today + 'T00:00:00Z')

      if (now > sleepEndTime && sleepStartTime >= todayStart) {
        
        // Reset all habit completions for today
        const { error: resetError } = await supabase
          .from('cassian_habits_daily_logs')
          .update({ is_completed: false })
          .eq('user_id', user.id)
          .eq('log_date', today)

        if (resetError) {
          console.error('Error resetting habits after sleep:', resetError)
        }
      } else {
        
      }
    } catch (err) {
      console.error('Error checking sleep status:', err)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchHabits(() => cancelled)
    return () => { cancelled = true }
  }, [user, selectedDate])

  // Get next habit coming up (uncompleted habit with earliest start time after sleep)
  const getNextHabit = () => {
    // Filter for uncompleted habits that occur after sleep time
    const uncompletedHabitsAfterSleep = habits.filter(habit => {
      const dailyLog = habit.habits_daily_logs?.[0]
      const isNotCompleted = !dailyLog?.actual_start_time

      // If not completed, check if it's after sleep time
      if (isNotCompleted && sleepStartTime && habit.current_start_time) {
        return habit.current_start_time > sleepStartTime
      }

      // If no sleep time or no start time, include all uncompleted habits
      return isNotCompleted
    })

    
    if (uncompletedHabitsAfterSleep.length === 0) {
      
      // If no uncompleted habits after sleep, default to first habit after sleep time
      const habitsAfterSleep = habits.filter(habit => {
        if (!sleepStartTime || !habit.current_start_time) return true
        return habit.current_start_time > sleepStartTime
      })

      
      return habitsAfterSleep[0] || habits[0]
    }

    // Sort by start time and return the earliest
    return uncompletedHabitsAfterSleep.sort((a, b) => {
      const timeA = a.current_start_time || '23:59'
      const timeB = b.current_start_time || '23:59'
      return timeA.localeCompare(timeB)
    })[0]
  }

  return {
    habits,
    loading,
    error,
    logHabitCompletion,
    updateHabitStartTime,
    updateHabitType,
    updateHabitDuration,
    updateHabitName,
    updateHabitDefaultStartTime,
    updateHabitWeeklyDays,
    archiveHabit,
    unarchiveHabit,
    deleteHabit,
    createHabit,
    updateHabitStartTimes,
    refetch: () => fetchHabits(),
    getNextHabit,
    lastSleepTime: sleepStartTime,
  }
}
