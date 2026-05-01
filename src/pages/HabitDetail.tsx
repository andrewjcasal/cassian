import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Circle } from 'lucide-react'
import { useHabits } from '../hooks/useHabits'
import HabitDetailTabs from '../components/HabitDetailTabs'
import LoadingSpinner from '../components/LoadingSpinner'
import { formatTimeOfDay } from '../utils/formatTime'

const HabitDetail = () => {
  const { habitId } = useParams<{ habitId: string }>()
  const navigate = useNavigate()
  const { habits, logHabitCompletion } = useHabits()
  
  const habit = habits.find(h => h.id === habitId)
  const todayString = new Date().toISOString().split('T')[0]
  const habitLog = habit?.habits_daily_logs?.find(log => log.log_date === todayString)

  const toggleHabitCompletion = async () => {
    if (!habit) return

    const isCompleted = habitLog?.is_completed || false
    const now = new Date()
    const currentTime = now.toTimeString().slice(0, 5) // HH:MM format

    await logHabitCompletion(
      habit.id,
      !isCompleted,
      !isCompleted ? currentTime : undefined,
      !isCompleted ? currentTime : undefined
    )
  }

  const formatTime = (time: string | null) => formatTimeOfDay(time, '9:00 AM')

  const handleHabitDeleted = () => {
    navigate('/habits')
  }

  if (!habit) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <LoadingSpinner message="Loading habit..." />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Use the existing HabitDetailTabs component with custom props */}
      <HabitDetailTabs
        habitId={habit.id}
        habitName={habit.name}
        initialTab="settings"
        initialContext={{
          background: habit.background || '',
          benefits: habit.benefits || '',
          consequences: habit.consequences || '',
        }}
        onHabitDeleted={handleHabitDeleted}
        showBackButton={true}
        onBackClick={() => navigate('/habits')}
      />
    </div>
  )
}

export default HabitDetail