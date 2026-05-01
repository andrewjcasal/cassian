import { useState, useEffect } from 'react'
import ModalWrapper from './ModalWrapper'
import { useHabitTypes } from '../hooks/useHabitTypes'

interface CreateHabitModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateHabit: (habitData: {
    name: string
    duration: number
    habit_type_id: string
    default_start_time?: string
    background: string
    benefits: string
    consequences: string
    weekly_days?: string[] | null
  }) => Promise<void>
  onUnarchive?: (
    habitId: string,
    updates: { duration: number; default_start_time: string; weekly_days: string[] | null }
  ) => Promise<void>
  defaultTime?: string
  defaultDuration?: number
  defaultWeeklyDays?: string[]
  lockedName?: string
  existingHabitId?: string
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const CreateHabitModal = ({ isOpen, onClose, onCreateHabit, onUnarchive, defaultTime, defaultDuration, defaultWeeklyDays, lockedName, existingHabitId }: CreateHabitModalProps) => {
  const [name, setName] = useState(lockedName ?? '')
  const [duration, setDuration] = useState(defaultDuration ?? 30)
  const [defaultStartTime, setDefaultStartTime] = useState(defaultTime ?? '09:00')
  const [weeklyDays, setWeeklyDays] = useState<string[]>(defaultWeeklyDays ?? [])
  const [loading, setLoading] = useState(false)

  // When the modal opens, re-sync from the latest defaults so re-triggering
  // from a different slot pre-fills the new values.
  useEffect(() => {
    if (!isOpen) return
    setName(lockedName ?? '')
    setDefaultStartTime(defaultTime ?? '09:00')
    setDuration(defaultDuration ?? 30)
    setWeeklyDays(defaultWeeklyDays ?? [])
  }, [isOpen, defaultTime, defaultDuration, defaultWeeklyDays, lockedName])

  const { habitTypes } = useHabitTypes()
  const fixedType = habitTypes.find(t => t.scheduling_rule === 'fixed_time')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !fixedType) return

    setLoading(true)
    try {
      if (existingHabitId && onUnarchive) {
        // Reuse the existing (archived) habit: unarchive and overwrite its
        // schedule defaults instead of creating a duplicate.
        await onUnarchive(existingHabitId, {
          duration,
          default_start_time: defaultStartTime,
          weekly_days: weeklyDays.length > 0 ? weeklyDays : null,
        })
        onClose()
        return
      }

      await onCreateHabit({
        name: name.trim(),
        duration,
        habit_type_id: fixedType.id,
        default_start_time: defaultStartTime,
        background: '',
        benefits: '',
        consequences: '',
        weekly_days: weeklyDays.length > 0 ? weeklyDays : null,
      })

      setName('')
      setDuration(30)
      setDefaultStartTime('09:00')
      setWeeklyDays([])
      onClose()
    } catch (error) {
      console.error('Error creating habit:', error)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title="New Habit" maxWidth="md">
      <form onSubmit={handleSubmit} className="space-y-1">
        <div className="relative">
          <input
            type="text"
            placeholder="Habit name"
            value={name}
            onChange={e => setName(e.target.value)}
            readOnly={!!lockedName}
            className={`w-full px-1 py-1 border border-neutral-300 rounded-md text-xs ${
              lockedName ? 'bg-neutral-50 text-neutral-700' : ''
            }`}
            autoFocus={!lockedName}
            required
          />
        </div>

        <div className="flex gap-1">
          <input
            type="time"
            value={defaultStartTime}
            onChange={e => setDefaultStartTime(e.target.value)}
            className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
            required
          />
          <input
            type="number"
            value={duration}
            onChange={e => setDuration(parseInt(e.target.value) || 0)}
            className="flex-1 px-1 py-1 border border-neutral-300 rounded-md text-xs"
            min={1}
            max={480}
            placeholder="Duration (min)"
            required
          />
        </div>

        <div className="flex flex-wrap gap-1 pt-0.5">
          {WEEKDAYS.map(day => {
            const isActive = weeklyDays.includes(day)
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setWeeklyDays(prev =>
                    isActive ? prev.filter(d => d !== day) : [...prev, day]
                  )
                }}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                }`}
              >
                {day.slice(0, 3)}
              </button>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-1 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs text-neutral-600 hover:text-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim() || (!existingHabitId && !fixedType)}
            className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? existingHabitId ? 'Adding...' : 'Creating...'
              : existingHabitId ? 'Add' : 'Create'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}

export default CreateHabitModal
