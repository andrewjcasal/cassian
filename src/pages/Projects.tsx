import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Settings, Folder, Zap, Info, Crown, Calendar, Plus, ArrowLeft } from 'lucide-react'
import { useProjects, usePublicTasks } from '../hooks/useProjects'
import { usePublicSessions } from '../hooks/useContracts'
import { useProjectsPageData } from '../hooks/useProjectsPageData'
import { Project, Task } from '../types'
import { supabase } from '../lib/supabase'
import NewProjectModal from '../components/NewProjectModal'
import NewSessionModal from '../components/NewSessionModal'
import ProjectSettingsModal from '../components/ProjectSettingsModal'
import TaskModal from '../components/TaskModal'
import DayViewModal from '../components/DayViewModal'
import SessionsList from '../components/SessionsList'
import TasksList from '../components/TasksList'

const Projects = () => {
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [isPublicView, setIsPublicView] = useState(false)

  // Use single consolidated hook for all authenticated user data
  const {
    user,
    userLoading,
    projects,
    selectedProject,
    tasks,
    sessions,
    projectsLoading,
    tasksLoading,
    sessionsLoading,
    error: dataError,
    addProject,
    updateProject,
    deleteProject,
    addTask,
    updateTask,
    deleteTask,
    updateSession,
    createSessionsWithContract,
    refetchTasks,
    refetchSessions,
    fetchProjects,
  } = useProjectsPageData(selectedProjectId)

  // Public project hooks (only for non-authenticated users)
  const projectParam = searchParams.get('project')
  const {
    project: publicProject,
    loading: publicProjectLoading,
    error: publicProjectError,
    isShareable,
  } = useProjects(
    user ? null : undefined, // Pass null when authenticated to prevent any query
    !user && projectParam ? projectParam : undefined // Only pass projectName for public access
  )

  const { tasks: publicTasks, loading: publicTasksLoading } = usePublicTasks(
    !user && publicProject?.id ? publicProject.id : undefined
  )

  const { sessions: publicSessions, loading: publicSessionsLoading } = usePublicSessions(
    !user && publicProject?.id ? publicProject.id : undefined
  )

  // Determine which data to use based on authentication status
  const currentProject = user ? selectedProject : publicProject
  const currentTasks = user ? tasks : publicTasks
  const currentSessions = user ? sessions : publicSessions
  const currentTasksLoading = user ? tasksLoading : publicTasksLoading
  const currentSessionsLoading = user ? sessionsLoading : publicSessionsLoading

  // Modal states
  const [showNewProjectForm, setShowNewProjectForm] = useState(false)
  const [showNewSessionForm, setShowNewSessionForm] = useState(false)
  const [showProjectSettings, setShowProjectSettings] = useState(false)
  const [showDayView, setShowDayView] = useState(false)
  const [showTaskModal, setShowTaskModal] = useState(false)

  // Selected items
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activeSessionTab, setActiveSessionTab] = useState<'past' | 'upcoming'>('upcoming')

  const handleProjectSelect = useCallback(
    (project: Project | null) => {
      if (project) {
        // Update URL query param first
        setSearchParams({ project: project.name })

        // Save to localStorage
        localStorage.setItem('selectedProject', JSON.stringify(project))

        // Set selected project ID
        setSelectedProjectId(project.id)
      } else {
        // Clear URL query param and localStorage
        setSearchParams({})
        localStorage.removeItem('selectedProject')
        setSelectedProjectId(null)
      }
    },
    [setSearchParams]
  )

  const handleUpdateProject = useCallback(
    async (projectId: string, data: any) => {
      await updateProject(projectId, data)

      // If a project was archived, refresh the projects list to remove it from the dropdown
      if (data.status === 'archived') {
        await fetchProjects()
      }
    },
    [updateProject, fetchProjects]
  )

  const handleToggleTaskStatus = async (task: Task) => {
    const newStatus = task.status === 'completed' ? 'todo' : 'completed'
    try {
      await updateTask(task.id, { status: newStatus })
    } catch (error) {
      console.error('Error updating task:', error)
    }
  }

  const handleCompleteSessionTasks = async (sessionId: string) => {
    try {
      // Find the session to get its assigned tasks
      const session = sessionsToShow.find(s => s.id === sessionId)
      if (!session || !session.assignedTasks) {
        console.warn('Session not found or has no assigned tasks')
        return
      }

      // Mark all assigned tasks as completed
      for (const task of session.assignedTasks) {
        await updateTask(task.id, { status: 'completed' })
      }

      // Create associations in session_tasks table
      const sessionTasksData = session.assignedTasks.map(task => ({
        session_id: sessionId,
        task_id: task.id,
      }))

      const { error: sessionTasksError } = await supabase
        .from('cassian_session_tasks')
        .upsert(sessionTasksData, {
          onConflict: 'session_id,task_id',
          ignoreDuplicates: true,
        })

      if (sessionTasksError) {
        console.error('Error creating session-task associations:', sessionTasksError)
        // Don't throw here - tasks are still completed even if association fails
      }

      // Update session notes with completed tasks
      const taskNames = session.assignedTasks.map(task => task.title).join(', ')
      const updatedNotes = session.notes
        ? `${session.notes}\n\nCompleted tasks: ${taskNames}`
        : `Completed tasks: ${taskNames}`

      await updateSession(sessionId, {
        notes: updatedNotes,
        status: 'completed',
      })

      // Refresh tasks and sessions to show updated status
      await refetchTasks()
      await refetchSessions()
    } catch (error) {
      console.error('Error completing session tasks:', error)
      throw error // Re-throw so modal stays open on error
    }
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setShowTaskModal(true)
  }

  // Initialize project from URL or localStorage
  useEffect(() => {
    if (!user) {
      // For unauthenticated users, set the public project if available
      if (publicProject) {
        setSelectedProjectId(publicProject.id)
        setIsPublicView(true)
      }
      return
    }

    if (!projects.length || projectsLoading || userLoading) return

    const projectParam = searchParams.get('project')
    let projectToSelect: Project | null = null

    if (projectParam) {
      // Decode the URL parameter to handle spaces and special characters
      const decodedProjectName = decodeURIComponent(projectParam.replace(/\+/g, ' '))
      projectToSelect = projects.find(p => p.name === decodedProjectName) || null
    }

    if (!projectToSelect) {
      const savedProject = localStorage.getItem('selectedProject')
      if (savedProject) {
        try {
          const parsedProject = JSON.parse(savedProject)
          projectToSelect = projects.find(p => p.id === parsedProject.id) || null
        } catch (error) {
          console.error('Error parsing saved project:', error)
        }
      }
    }

    if (projectToSelect && (!selectedProject || selectedProject.id !== projectToSelect.id)) {
      setSelectedProjectId(projectToSelect.id)
      setIsPublicView(false)
    } else if (selectedProject && !projects.find(p => p.id === selectedProject.id)) {
      // If selected project is no longer in the active projects list (e.g., archived), clear it
      setSelectedProjectId(null)
      setSearchParams({})
      localStorage.removeItem('selectedProject')
    }
  }, [user, userLoading, projects, projectsLoading, searchParams, publicProject])

  // Sessions logic
  const upcomingSessions = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayString = today.toISOString().split('T')[0]

    return currentSessions
      .filter(session => {
        const sessionDate = new Date(session.scheduled_date + 'T00:00:00')
        const hasSessionTasks =
          (session as any).session_tasks && (session as any).session_tasks.length > 0
        const isAfterToday = sessionDate > today
        const isTodayWithoutCompletion =
          session.scheduled_date === todayString &&
          session.status !== 'completed' &&
          !hasSessionTasks

        return isAfterToday || isTodayWithoutCompletion
      })
      .sort((a, b) => {
        // Sort by scheduled_date ascending (earliest first)
        const dateA = new Date(a.scheduled_date + 'T00:00:00')
        const dateB = new Date(b.scheduled_date + 'T00:00:00')
        return dateA.getTime() - dateB.getTime()
      })
  }, [currentSessions])

  const pastSessions = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayString = today.toISOString().split('T')[0]

    return currentSessions
      .filter(session => {
        const sessionDate = new Date(session.scheduled_date + 'T00:00:00')
        const isBeforeToday = sessionDate < today
        const hasSessionTasks =
          (session as any).session_tasks && (session as any).session_tasks.length > 0
        const isTodayWithCompletedTasks =
          session.scheduled_date === todayString &&
          (session.status === 'completed' || hasSessionTasks)

        return isBeforeToday || isTodayWithCompletedTasks
      })
      .sort((a, b) => {
        // Sort by scheduled_date descending (most recent first)
        const dateA = new Date(a.scheduled_date + 'T00:00:00')
        const dateB = new Date(b.scheduled_date + 'T00:00:00')
        return dateB.getTime() - dateA.getTime()
      })
  }, [currentSessions])

  const sessionsWithTasks = useMemo(() => {
    const incompleteTasks = currentTasks.filter(task => task.status !== 'completed')

    const sessionsWithTasks = upcomingSessions.map(session => ({
      ...session,
      assignedTasks: [] as Task[],
    }))

    let currentSessionIndex = 0
    let currentSessionHours = 0

    const sortedTasks = [...incompleteTasks].sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 }
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority]
      if (priorityDiff !== 0) return priorityDiff
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

    for (const task of sortedTasks) {
      // If task has subtasks, assign subtasks individually; otherwise assign the task itself
      if (task.subtasks && task.subtasks.length > 0) {
        // Sort subtasks by priority and creation date (same as parent tasks)
        const sortedSubtasks = [...task.subtasks]
          .filter(subtask => subtask.status !== 'completed') // Only incomplete subtasks
          .sort((a, b) => {
            const priorityOrder = { high: 3, medium: 2, low: 1 }
            const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority]
            if (priorityDiff !== 0) return priorityDiff
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          })

        for (const subtask of sortedSubtasks) {
          const subtaskHours = subtask.estimated_hours || 1
          let remainingSubtaskHours = subtaskHours

          console.log(
            `  🔹 Processing subtask: ${task.title} - ${subtask.title} (${subtaskHours}h)`
          )

          // Assign this subtask to sessions
          while (remainingSubtaskHours > 0 && currentSessionIndex < sessionsWithTasks.length) {
            const currentSessionCapacity = sessionsWithTasks[currentSessionIndex].scheduled_hours
            const availableCapacity = currentSessionCapacity - currentSessionHours

            console.log(
              `    📍 Session ${currentSessionIndex} (${sessionsWithTasks[currentSessionIndex].scheduled_date}): ${currentSessionHours}/${currentSessionCapacity}h used, ${availableCapacity}h available`
            )

            if (availableCapacity > 0) {
              // Add subtask to current session
              if (
                !sessionsWithTasks[currentSessionIndex].assignedTasks.find(t => t.id === subtask.id)
              ) {
                // Create a modified subtask that shows parent task context
                const subtaskWithContext = {
                  ...subtask,
                  title: `${task.title} - ${subtask.title}`, // Show as "Production - test one"
                }
                sessionsWithTasks[currentSessionIndex].assignedTasks.push(subtaskWithContext)
              }

              // Use available capacity
              const hoursToAllocate = Math.min(remainingSubtaskHours, availableCapacity)
              currentSessionHours += hoursToAllocate
              remainingSubtaskHours -= hoursToAllocate
              console.log(
                `    ⏱️ Allocated ${hoursToAllocate}h, remaining: ${remainingSubtaskHours}h, session now: ${currentSessionHours}h`
              )
            }

            // If current session is full or subtask is fully allocated, move to next session
            if (currentSessionHours >= currentSessionCapacity || remainingSubtaskHours <= 0) {
              if (remainingSubtaskHours > 0) {
                currentSessionIndex++
                currentSessionHours = 0
              }
            }
          }

          if (remainingSubtaskHours > 0) {
            console.log(
              `    ⚠️ Subtask ${task.title} - ${subtask.title} has ${remainingSubtaskHours}h unallocated (no more sessions)`
            )
          }
        }
      } else {
        // Handle tasks without subtasks (original logic)
        const taskHours = task.estimated_hours || 1
        let remainingTaskHours = taskHours

        // Keep assigning this task across sessions until fully allocated
        while (remainingTaskHours > 0 && currentSessionIndex < sessionsWithTasks.length) {
          const currentSessionCapacity = sessionsWithTasks[currentSessionIndex].scheduled_hours
          const availableCapacity = currentSessionCapacity - currentSessionHours

          console.log(
            `  📍 Session ${currentSessionIndex} (${sessionsWithTasks[currentSessionIndex].scheduled_date}): ${currentSessionHours}/${currentSessionCapacity}h used, ${availableCapacity}h available`
          )

          if (availableCapacity > 0) {
            // Add task to current session
            if (!sessionsWithTasks[currentSessionIndex].assignedTasks.find(t => t.id === task.id)) {
              sessionsWithTasks[currentSessionIndex].assignedTasks.push(task)
            }

            // Use available capacity
            const hoursToAllocate = Math.min(remainingTaskHours, availableCapacity)
            currentSessionHours += hoursToAllocate
            remainingTaskHours -= hoursToAllocate
            console.log(
              `  ⏱️ Allocated ${hoursToAllocate}h, remaining: ${remainingTaskHours}h, session now: ${currentSessionHours}h`
            )
          }

          // If current session is full or task is fully allocated, move to next session
          if (currentSessionHours >= currentSessionCapacity || remainingTaskHours <= 0) {
            if (remainingTaskHours > 0) {
              currentSessionIndex++
              currentSessionHours = 0
            }
          }
        }

        if (remainingTaskHours > 0) {
          console.log(
            `  ⚠️ Task ${task.title} has ${remainingTaskHours}h unallocated (no more sessions)`
          )
        }
      }
    }

    return sessionsWithTasks
  }, [upcomingSessions, currentTasks])

  const handleCopyToClipboard = useCallback(
    async (sessionIndex: number, sessionsWithTasks: any[]) => {
      const currentSession = sessionsWithTasks[sessionIndex]
      const currentTasks = currentSession?.assignedTasks || []

      const upcomingTasks = sessionsWithTasks
        .slice(sessionIndex + 1)
        .flatMap(session => session.assignedTasks || [])

      let clipboardText = ''

      if (currentTasks.length > 0) {
        clipboardText = currentTasks.map(task => task.title).join(', ')
      }

      if (upcomingTasks.length > 0) {
        const upcomingText = upcomingTasks.map(task => task.title).join(', ')
        if (clipboardText) {
          clipboardText += `, Next: ${upcomingText}`
        } else {
          clipboardText = `Next: ${upcomingText}`
        }
      }

      const text = clipboardText || 'No tasks assigned'

      try {
        await navigator.clipboard.writeText(text)
      } catch (error) {
        console.error('Failed to copy to clipboard:', error)
      }
    },
    []
  )

  // Update selectedTask when tasks change
  useEffect(() => {
    if (selectedTask && currentTasks.length > 0) {
      const updatedTask = currentTasks.find(t => t.id === selectedTask.id)
      if (updatedTask) {
        setSelectedTask(updatedTask)
      }
    }
  }, [currentTasks, selectedTask?.id])

  const sessionsToShow = activeSessionTab === 'upcoming' ? sessionsWithTasks : pastSessions

  // Show loading while checking user authentication or public project
  if (userLoading || (!user && publicProjectLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  // Show error for unauthenticated users if project doesn't exist or isn't shareable
  if (!user && publicProjectError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50">
        <div className="text-center">
          <div className="mb-4">
            <Folder className="w-16 h-16 mx-auto text-neutral-300" />
          </div>
          <h3 className="text-lg font-medium mb-2 text-neutral-900">Project Not Found</h3>
          <p className="text-sm text-neutral-600">
            This project doesn't exist or isn't publicly accessible.
          </p>
        </div>
      </div>
    )
  }

  const ProjectContent = () => (
    <div className="flex flex-col h-screen bg-white overflow-hidden max-w-full">
      {/* Top Navigation - only show for authenticated users when a project is selected */}
      {user && selectedProject && (
        <nav className="border-b border-neutral-200 bg-white flex items-center flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => handleProjectSelect(null)}
              className="flex items-center gap-1 px-2 py-1 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 border-r border-neutral-200 transition-colors"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>All projects</span>
            </button>
            <span className="text-sm font-medium text-neutral-900 truncate">
              {selectedProject.name}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowProjectSettings(true)}
                className="flex items-center gap-1 px-2 py-0.5 my-0.5 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded transition-colors"
              >
                <Settings className="w-2.5 h-2.5" />
                <span>Project Settings</span>
              </button>
            </div>
          </div>
        </nav>
      )}

      {/* Public project header for unauthenticated users */}
      {!user && currentProject && (
        <nav className="border-b border-neutral-200 bg-white flex flex-col items-left flex-shrink-0 px-2 py-2">
          <div className="flex items-center gap-1">
            <Crown className="w-3 h-3 text-primary-600" />
            <span className="text-lg font-medium text-primary-700">Cassian</span>
            <span className="text-lg font-semibold text-neutral-500">for</span>
            <h1 className="text-lg font-semibold text-neutral-900">{currentProject.name}</h1>
          </div>
        </nav>
      )}

      {/* Info Banner - show when no projects exist - authenticated users only */}
      {user && projects.length === 0 && !projectsLoading && (
        <div className="mx-4 mt-4 px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 mt-0.5 flex-shrink-0 text-blue-500" />
            <div>
              <h3 className="text-sm font-medium text-blue-900 mb-1">
                Create a project to get started!
              </h3>
              <p className="text-sm text-blue-700 leading-relaxed">
                Add projects and tasks to populate your calendar and watch them auto-shuffle as you
                complete work. Projects help organize your tasks and track progress over time.
              </p>
            </div>
          </div>
        </div>
      )}


      {/* Modals - only for authenticated users */}
      {user && (
        <>
          <NewProjectModal
            isOpen={showNewProjectForm}
            onClose={() => setShowNewProjectForm(false)}
            onCreateProject={addProject}
            onProjectSelect={(project: Project) => handleProjectSelect(project)}
          />

          <NewSessionModal
            isOpen={showNewSessionForm}
            onClose={() => setShowNewSessionForm(false)}
            selectedProject={selectedProject}
            onCreateSessions={createSessionsWithContract}
          />

          <ProjectSettingsModal
            isOpen={showProjectSettings}
            onClose={() => setShowProjectSettings(false)}
            selectedProject={selectedProject}
            onUpdateProject={handleUpdateProject}
            onProjectSelect={handleProjectSelect}
            projects={projects}
          />

          <TaskModal
            isOpen={showTaskModal}
            onClose={() => setShowTaskModal(false)}
            selectedTask={selectedTask}
            selectedProject={currentProject}
            onAddTask={addTask}
            onUpdateTask={updateTask}
            onDeleteTask={deleteTask}
            onRefetchTasks={refetchTasks}
            onToggleTaskStatus={handleToggleTaskStatus}
          />

          <DayViewModal isOpen={showDayView} onClose={() => setShowDayView(false)} />
        </>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 w-full overflow-hidden">
        {currentProject ? (
          <div className="flex-1 flex overflow-hidden">
            {/* Conditionally show SessionsList only if project has sessions */}
            {currentProject.has_sessions && (
              <SessionsList
                activeSessionTab={activeSessionTab}
                onSetActiveSessionTab={setActiveSessionTab}
                onShowNewSessionForm={() => setShowNewSessionForm(true)}
                sessionsLoading={currentSessionsLoading}
                sessionsToShow={sessionsToShow}
                onCopyToClipboard={handleCopyToClipboard}
                onUpdateSession={user ? updateSession : undefined}
                onCompleteSessionTasks={user ? handleCompleteSessionTasks : undefined}
              />
            )}

            <TasksList
              tasks={currentTasks}
              tasksLoading={currentTasksLoading}
              fullWidth={!currentProject.has_sessions}
              selectedProject={currentProject}
              onAddTask={user ? addTask : undefined}
              onTaskClick={user ? handleTaskClick : undefined}
              onToggleTaskStatus={user ? handleToggleTaskStatus : undefined}
              onUpdateTask={user ? updateTask : undefined}
            />
          </div>
        ) : user ? (
          <div className="flex-1 overflow-y-auto px-6 py-8 bg-[#FDFBF7]">
            <div className="max-w-4xl mx-auto">
              <div className="flex items-baseline justify-between mb-6">
                <h1 className="font-serif text-3xl text-neutral-900">Projects</h1>
                <span className="text-sm text-neutral-500">
                  {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                </span>
              </div>

              {projectsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {projects.map(project => (
                    <button
                      key={project.id}
                      onClick={() => handleProjectSelect(project)}
                      className="group text-left bg-white border border-neutral-200 hover:border-amber-400 hover:shadow-md rounded-lg p-5 transition-all"
                    >
                      <h3 className="font-serif text-lg text-neutral-900 truncate">
                        {project.name}
                      </h3>
                      {project.description ? (
                        <p className="text-sm text-neutral-600 mt-1 line-clamp-2">
                          {project.description}
                        </p>
                      ) : (
                        <p className="text-sm text-neutral-400 mt-1 italic">No description</p>
                      )}
                    </button>
                  ))}

                  <button
                    onClick={() => setShowNewProjectForm(true)}
                    className="text-left border border-dashed border-neutral-300 hover:border-amber-400 hover:bg-white rounded-lg p-5 transition-all flex items-center gap-3 text-neutral-500 hover:text-neutral-900"
                  >
                    <div className="w-9 h-9 flex items-center justify-center rounded-md bg-white border border-neutral-200 flex-shrink-0">
                      <Plus className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-sm">New project</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500">
            <div className="text-center">
              <div className="mb-4">
                <Folder className="w-16 h-16 mx-auto text-neutral-300" />
              </div>
              <h3 className="text-lg font-medium mb-2">No project</h3>
            </div>
          </div>
        )}
      </main>
    </div>
  )

  // Return appropriate layout based on authentication status
  if (!user) {
    // Public view - no navigation
    return <ProjectContent />
  } else {
    // Authenticated view - handled by MainLayout in App.tsx
    return <ProjectContent />
  }
}

export default Projects
