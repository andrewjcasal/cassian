import { useMemo } from 'react'
import { format } from 'date-fns'
import ModalWrapper from './ModalWrapper'

interface ProjectActivityModalProps {
  isOpen: boolean
  activity: any | null
  allActivity: any[]
  onClose: () => void
  onDelete: () => Promise<void> | void
}

const formatDuration = (minutes: number): string => {
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

const ProjectActivityModal = ({ isOpen, activity, allActivity, onClose, onDelete }: ProjectActivityModalProps) => {
  const projectId = activity?.project_id
  const projectName = activity?.projects?.name || 'Project'
  const projectColor = activity?.projects?.color as string | undefined

  const { entryMinutes, totalMinutes, entryCount } = useMemo(() => {
    if (!activity) return { entryMinutes: 0, totalMinutes: 0, entryCount: 0 }
    const entryMs = new Date(activity.end_time).getTime() - new Date(activity.start_time).getTime()
    const matched = allActivity.filter(a => a.project_id === projectId)
    const totalMs = matched.reduce(
      (acc, a) => acc + (new Date(a.end_time).getTime() - new Date(a.start_time).getTime()),
      0
    )
    return {
      entryMinutes: entryMs / 60000,
      totalMinutes: totalMs / 60000,
      entryCount: matched.length,
    }
  }, [activity, allActivity, projectId])

  if (!isOpen || !activity) return null

  const start = new Date(activity.start_time)
  const end = new Date(activity.end_time)

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title={projectName} maxWidth="sm">
      <div className="space-y-2">
        {projectColor && (
          <div className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: projectColor }}
            />
            <span>{projectName}</span>
          </div>
        )}

        <div className="text-xs text-neutral-500">
          {format(start, 'EEEE, MMM d, yyyy')}
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-700">
          <span>{format(start, 'h:mm a')}</span>
          <span className="text-neutral-400">—</span>
          <span>{format(end, 'h:mm a')}</span>
          <span className="text-neutral-400">({formatDuration(entryMinutes)})</span>
        </div>

        {activity.note && (
          <p className="text-xs text-neutral-500">{activity.note}</p>
        )}

        <div className="pt-2 border-t border-neutral-100">
          <div className="text-xs text-neutral-500">Total time on this project</div>
          <div className="text-sm font-semibold text-neutral-900">
            {formatDuration(totalMinutes)}
            <span className="ml-1 text-xs font-normal text-neutral-500">
              across {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>

        <div className="flex justify-between pt-1">
          <button
            type="button"
            onClick={onDelete}
            className="px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-neutral-600 text-xs hover:text-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}

export default ProjectActivityModal
