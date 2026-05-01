import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  RefreshCw,
} from 'lucide-react'
import { useHabits } from '../hooks/useHabits'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import LoadingSpinner from '../components/LoadingSpinner'
import TabNavigation from '../components/TabNavigation'
import HabitsMainContent from '../components/HabitsMainContent'
import HabitsLast7Days from '../components/HabitsLast7Days'
import { getEffectiveHabitStartTime } from '../utils/habitScheduling'
import { formatTimeOfDay } from '../utils/formatTime'
import Aspects from './Aspects'

const Habits = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0])
  const {
    habits,
    loading,
    error,
    logHabitCompletion,
    updateHabitStartTime,
    updateHabitStartTimes,
    createHabit,
    unarchiveHabit,
    getNextHabit,
    lastSleepTime,
  } = useHabits(selectedDate)

  const [routineLogs, setRoutineLogs] = useState<any[]>([])
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  
  // Update URL when habit selection changes
  const handleHabitSelect = (habitId: string | null) => {
    if (!habitId) {
      setSelectedHabitId(null)
      setSearchParams({})
      return
    }

    // Check if we're on mobile
    const isMobile = window.innerWidth < 768 // md breakpoint
    
    if (isMobile) {
      // Navigate to habit detail page on mobile
      navigate(`/habits/${habitId}`)
    } else {
      // Show in sidebar on desktop
      setSelectedHabitId(habitId)
      setSearchParams({ habitId, tab: 'settings' })
    }
  }
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [activeTopTab, setActiveTopTab] = useState<'habits' | 'progress' | 'aspects'>('habits')
  const [initialDetailTab, setInitialDetailTab] = useState<'subhabits' | 'settings'>('settings')

  // Handle query parameters for returning from notes
  useEffect(() => {
    const habitId = searchParams.get('habitId')
    const tab = searchParams.get('tab')

    if (habitId) {
      setSelectedHabitId(habitId)
      if (tab && (tab === 'subhabits' || tab === 'settings')) {
        setInitialDetailTab(tab as 'subhabits' | 'settings')
      }
    }
  }, [searchParams, setSearchParams])

  // Helper function to get the display text and time for habit scheduling
  const getHabitScheduleDisplay = (habit: any, dailyLog: any) => {
    const today = new Date().toISOString().split('T')[0]
    const isToday = selectedDate === today
    const isCompleted = dailyLog?.actual_start_time || false

    if (isToday && !isCompleted) {
      // Today, not completed - show "Today: [pull-back time]"
      const effectiveTime = getEffectiveHabitStartTime(habit, selectedDate, dailyLog)
      return { label: 'Today', time: effectiveTime }
    } else {
      // Completed today or future date - show "Next: [tomorrow's pull-back time]"
      const tomorrow = new Date(selectedDate)
      tomorrow.setDate(tomorrow.getDate() + 1)
      const tomorrowStr = tomorrow.toISOString().split('T')[0]
      const effectiveTime = getEffectiveHabitStartTime(habit, tomorrowStr)
      return { label: 'Next', time: effectiveTime }
    }
  }

  const toggleCompletion = async (habitId: string) => {
    const habit = habits.find(h => h.id === habitId)
    const currentLog = habit?.habits_daily_logs?.find(log => log.log_date === selectedDate)
    const newCompletionState = !currentLog?.is_completed

    const now = new Date()
    const currentTime = now.toTimeString().slice(0, 5) // HH:MM format

    await logHabitCompletion(
      habitId,
      newCompletionState,
      newCompletionState ? currentTime : undefined,
      newCompletionState ? currentTime : undefined
    )
  }

  const navigateDate = (direction: 'prev' | 'next') => {
    const current = new Date(selectedDate)
    if (direction === 'prev') {
      current.setDate(current.getDate() - 1)
    } else {
      current.setDate(current.getDate() + 1)
    }
    setSelectedDate(current.toISOString().split('T')[0])
  }

  const formatDateDisplay = (dateString: string) => {
    const date = new Date(dateString)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const todayString = today.toISOString().split('T')[0]
    const yesterdayString = yesterday.toISOString().split('T')[0]

    if (dateString === todayString) {
      return 'Today'
    } else if (dateString === yesterdayString) {
      return 'Yesterday'
    } else {
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      })
    }
  }

  const updateCompletedTime = async (habitId: string, newTime: string) => {
    const habit = habits.find(h => h.id === habitId)
    const currentLog = habit?.habits_daily_logs?.find(log => log.log_date === selectedDate)

    if (currentLog?.is_completed) {
      await logHabitCompletion(
        habitId,
        true,
        newTime,
        newTime // Using same time for start and end - you might want to calculate end time based on duration
      )
    }
    setEditingCompletedTime(null)
  }

  const formatTime = (time: string | null) => formatTimeOfDay(time, '9:00 AM')

  const fetchRoutineLogs = async (cancelled?: () => boolean) => {
    if (!user) return

    try {
      // Get sleep logs to determine day boundaries
      const { data: sleepLogs, error: sleepError } = await supabase
        .from('cassian_habits_time_logs')
        .select('start_time')
        .eq('user_id', user.id)
        .eq('activity_type_id', '951bc26a-a863-4996-8a02-f4da2d148aa9')
        .order('start_time', { ascending: false })
        .limit(10)

      if (cancelled?.()) return
      if (sleepError) throw sleepError

      // Get routine logs from the last 14 days to account for sleep boundaries
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 14)
      const endDate = new Date()

      const { data, error } = await supabase
        .from('cassian_habits_daily_logs')
        .select(
          `
          log_date,
          actual_start_time,
          actual_end_time,
          created_at,
          habits:cassian_habits!inner (
            id,
            name
          )
        `
        )
        .eq('user_id', user.id)
        .gte('log_date', startDate.toISOString().split('T')[0])
        .lte('log_date', endDate.toISOString().split('T')[0])
        .in('habits.id', [
          'ad94f045-1f1f-49c6-aef1-578d0013cf9e',
          '0edf2ca9-b14f-451f-9043-e13cb8daf684',
        ])
        .order('log_date', { ascending: false })

      if (cancelled?.()) return
      if (error) throw error

      // Group logs by sleep cycles instead of calendar days
      const groupedLogs = []
      const sleepBoundaries = sleepLogs?.map(log => new Date(log.start_time)) || []

      for (let i = 0; i < 7; i++) {
        const currentSleep = sleepBoundaries[i]
        const previousSleep = sleepBoundaries[i + 1]

        if (!currentSleep) continue

        // Find logs that occurred between previous sleep and current sleep
        const dayLogs =
          data?.filter(log => {
            const logDateTime = new Date(log.created_at)

            // Must be before current sleep
            if (logDateTime >= currentSleep) return false

            // If there's a previous sleep, must be after that sleep
            if (previousSleep && logDateTime < previousSleep) return false

            return true
          }) || []

        // Use the day before sleep as the display date
        const displayDate = new Date(currentSleep)
        displayDate.setDate(displayDate.getDate() - 1)

        groupedLogs.push({
          sleepDate: currentSleep.toISOString().split('T')[0],
          sleepTime: currentSleep,
          displayDate: displayDate,
          logs: dayLogs,
        })
      }

      setRoutineLogs(groupedLogs)
    } catch (err) {
      console.error('Error fetching routine logs:', err)
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchRoutineLogs(() => cancelled)
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    // Auto-select the next habit when habits load
    if (habits.length > 0 && !selectedHabitId) {
      const nextHabit = getNextHabit()

      setSelectedHabitId(nextHabit?.id || null)
    }
  }, [habits, selectedHabitId])

  if (loading) {
    return <LoadingSpinner message="Loading habits..." />
  }

  if (error) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">Error loading habits: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* <TabNavigation activeTab={activeTopTab} onTabChange={setActiveTopTab} /> */}

      {activeTopTab === 'aspects' ? (
        <Aspects />
      ) : activeTopTab === 'progress' ? (
        <HabitsLast7Days />
      ) : (
        <HabitsMainContent
          habits={habits}
          loading={loading}
          selectedDate={selectedDate}
          selectedHabitId={selectedHabitId}
          showCreateModal={showCreateModal}
          initialDetailTab={initialDetailTab}
          onHabitSelect={handleHabitSelect}
          onToggleCompletion={toggleCompletion}
          onUpdateTime={updateHabitStartTime}
          onUpdateCompletedTime={updateCompletedTime}
          onNavigateDate={navigateDate}
          onShowCreateModal={setShowCreateModal}
          onCreateHabit={createHabit}
          onUnarchiveHabit={unarchiveHabit}
          formatDateDisplay={formatDateDisplay}
          getHabitScheduleDisplay={getHabitScheduleDisplay}
          formatTime={formatTime}
        />
      )}
    </div>
  )
}

export default Habits
