import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Archive } from 'lucide-react'
import HabitsList from './HabitsList'
import HabitDetailTabs from './HabitDetailTabs'
import CreateHabitModal from './CreateHabitModal'
import ArchivedHabitsList from './ArchivedHabitsList'

interface HabitsMainContentProps {
  habits: any[]
  loading: boolean
  selectedDate: string
  selectedHabitId: string | null
  showCreateModal: boolean
  initialDetailTab?: 'subhabits' | 'settings'
  onHabitSelect: (habitId: string | null) => void
  onToggleCompletion: (habitId: string) => void
  onUpdateTime: (habitId: string, time: string) => void
  onUpdateCompletedTime: (habitId: string, time: string) => void
  onNavigateDate: (direction: 'prev' | 'next') => void
  onShowCreateModal: (show: boolean) => void
  onCreateHabit: (habitData: any) => void
  onUnarchiveHabit: (habitId: string) => Promise<void>
  formatDateDisplay: (date: string) => string
  getHabitScheduleDisplay: (habit: any, dailyLog: any) => { label: string; time: string }
  formatTime: (time: string) => string
}

const HabitsMainContent = ({
  habits,
  loading,
  selectedDate,
  selectedHabitId,
  showCreateModal,
  initialDetailTab = 'settings',
  onHabitSelect,
  onToggleCompletion,
  onUpdateTime,
  onUpdateCompletedTime,
  onNavigateDate,
  onShowCreateModal,
  onCreateHabit,
  onUnarchiveHabit,
  formatDateDisplay,
  getHabitScheduleDisplay,
  formatTime,
}: HabitsMainContentProps) => {
  const selectedHabit = selectedHabitId ? habits.find(h => h.id === selectedHabitId) : null
  const [showArchived, setShowArchived] = useState(false)

  return (
    <>
      <div
        className="flex-1 grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-0 min-h-0 bg-[#FDFBF7]"
        style={{ height: 'calc(100vh - 200px)' }}
      >
        {/* Habits List - Outlook style */}
        <div className="flex flex-col bg-[#FDFBF7]">
          <div className="bg-[#FDFBF7] px-3 py-0.5">
            <div className="flex items-center justify-between">
              {showArchived ? (
                <h2 className="text-sm font-semibold text-gray-900 pl-[12px]">Archived</h2>
              ) : (
                <>
                  <button
                    onClick={() => onNavigateDate('prev')}
                    className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <h2 className="text-sm font-semibold text-gray-900">
                    {formatDateDisplay(selectedDate)}
                  </h2>
                </>
              )}
              <div className="flex items-center gap-1">
                {!showArchived && (
                  <button
                    onClick={() => onNavigateDate('next')}
                    className="p-0.5 hover:bg-gray-200 rounded transition-colors"
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
                <button
                  onClick={() => setShowArchived(prev => !prev)}
                  className={`p-1 rounded transition-colors ${
                    showArchived ? 'bg-amber-200 text-neutral-900' : 'hover:bg-gray-200 text-gray-600'
                  }`}
                  title={showArchived ? 'Back to habits' : 'View archived habits'}
                >
                  <Archive className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onShowCreateModal(true)}
                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                  title="Add new habit"
                >
                  <Plus className="w-3 h-3 text-gray-600" />
                </button>
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            {showArchived ? (
              <ArchivedHabitsList
                selectedHabitId={selectedHabitId}
                onHabitSelect={onHabitSelect}
              />
            ) : (
              <HabitsList
                habits={habits}
                selectedDate={selectedDate}
                selectedHabitId={selectedHabitId}
                onHabitSelect={onHabitSelect}
                onToggleCompletion={onToggleCompletion}
                onUpdateTime={onUpdateTime}
                onUpdateCompletedTime={onUpdateCompletedTime}
                getHabitScheduleDisplay={getHabitScheduleDisplay}
                formatTime={formatTime}
              />
            )}
          </div>
        </div>
        
        {/* Detail Panel - Show only selected habit on desktop */}
        <div className="bg-white self-start max-h-[calc(100%-1rem)] my-2 mr-2 rounded-lg overflow-hidden hidden lg:block">
          {selectedHabitId && (
            <HabitDetailTabs
              key={`detail-${selectedHabitId}`}
              habitId={selectedHabitId}
              habitName={selectedHabit?.name || ''}
              initialTab={initialDetailTab}
              initialContext={{
                background: selectedHabit?.background || '',
                benefits: selectedHabit?.benefits || '',
                consequences: selectedHabit?.consequences || '',
              }}
              onHabitDeleted={() => onHabitSelect(null)}
            />
          )}
        </div>
      </div>

      <CreateHabitModal
        isOpen={showCreateModal}
        onClose={() => onShowCreateModal(false)}
        onCreateHabit={onCreateHabit}
      />

    </>
  )
}

export default HabitsMainContent