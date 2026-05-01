import { useState, useRef, useEffect } from 'react'
import { Project } from '../types'
import ModalWrapper from './ModalWrapper'

interface NewProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateProject: (projectData: {
    name: string
    description: string
    status: string
  }) => Promise<Project>
  onProjectSelect: (project: Project) => void
}

const NewProjectModal = ({
  isOpen,
  onClose,
  onCreateProject,
  onProjectSelect,
}: NewProjectModalProps) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => nameRef.current?.focus(), 50)
    }
  }, [isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    try {
      const project = await onCreateProject({
        name: name.trim(),
        description: description.trim(),
        status: 'active',
      })
      onProjectSelect(project)
      setName('')
      setDescription('')
      onClose()
    } catch (error) {
      console.error('Error creating project:', error)
    } finally {
      setLoading(false)
    }
  }

  const titleNode = <h2 className="text-sm font-semibold text-neutral-900">New Project</h2>

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose} title={titleNode} maxWidth="sm">
      <form onSubmit={handleSubmit} className="space-y-2 pt-1">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Project name"
            className="w-full px-2 py-1 border border-neutral-300 rounded-md text-xs"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional"
            className="w-full px-2 py-1 border border-neutral-300 rounded-md text-xs resize-none"
            rows={2}
          />
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
            disabled={loading || !name.trim()}
            className="px-2 py-1 bg-primary-600 text-white rounded text-xs hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}

export default NewProjectModal
