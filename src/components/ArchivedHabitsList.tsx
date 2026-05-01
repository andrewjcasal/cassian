import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface ArchivedHabit {
  id: string
  name: string
  duration: number | null
  current_start_time: string | null
  weekly_days: string[] | null
}

interface ArchivedHabitsListProps {
  selectedHabitId: string | null
  onHabitSelect: (habitId: string | null) => void
}

const ArchivedHabitsList = ({ selectedHabitId, onHabitSelect }: ArchivedHabitsListProps) => {
  const [habits, setHabits] = useState<ArchivedHabit[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setLoading(false)
        return
      }
      const { data } = await supabase
        .from('cassian_habits')
        .select('id, name, duration, current_start_time, weekly_days')
        .eq('user_id', user.id)
        .eq('is_archived', true)
        .is('parent_habit_id', null)
        .order('name', { ascending: true })
      if (cancelled) return
      setHabits((data as ArchivedHabit[]) || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <p className="text-xs text-neutral-500 py-4 text-center">Loading…</p>
  }

  if (habits.length === 0) {
    return <p className="text-xs text-neutral-500 py-4 text-center">No archived habits.</p>
  }

  return (
    <div className="p-2 space-y-1.5">
      {habits.map(habit => {
        const isSelected = selectedHabitId === habit.id
        return (
          <div
            key={habit.id}
            onClick={() => onHabitSelect(habit.id)}
            className={`rounded-lg border px-2.5 py-1.5 cursor-pointer transition-all ${
              isSelected
                ? 'bg-amber-200 border-transparent shadow-sm'
                : 'bg-white/70 border-white hover:bg-white hover:shadow-sm'
            }`}
          >
            <div className="text-sm font-medium text-neutral-900 truncate">{habit.name}</div>
            <div className="text-[11px] text-neutral-500">
              {habit.current_start_time ? habit.current_start_time.slice(0, 5) : '—'}
              {habit.duration ? ` · ${habit.duration}m` : ''}
              {habit.weekly_days && habit.weekly_days.length > 0
                ? ` · ${habit.weekly_days.map(d => d.slice(0, 3)).join(', ')}`
                : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default ArchivedHabitsList
