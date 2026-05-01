import { format, addDays } from 'date-fns'

export interface BufferTime {
  id: string
  title: string
  startTime: string
  endTime: string
  duration: number // in minutes
  date: Date
  dateStr: string
  isBuffer: true
  isReduced: boolean
  isActive: boolean
}

export const generateDailyBuffer = (date: Date, meetings: any[] = [], projectActivity: any[] = []): BufferTime | null => {
  const dateStr = format(date, 'yyyy-MM-dd')
  const currentTime = new Date()
  const isToday = format(currentTime, 'yyyy-MM-dd') === dateStr

  // Don't generate buffers for past dates
  if (date < new Date(new Date().setHours(0, 0, 0, 0))) {
    return null
  }

  let startHour = 17.5 // 5:30 PM
  let duration = 60 // 1 hour
  let isReduced = false

  if (isToday) {
    const currentHour = currentTime.getHours()
    const currentMinute = currentTime.getMinutes()
    const currentTimeInMinutes = currentHour * 60 + currentMinute

    // If it's the same day, reduce by 30 minutes
    duration = 30
    isReduced = true

    // If it's after 1 PM (13:00), buffer disappears
    if (currentTimeInMinutes >= 13 * 60) {
      return null
    }
  }

  // Check for meeting / project-activity conflicts and adjust buffer position
  const bufferStart = startHour * 60 // 5:30 PM in minutes
  const bufferEnd = bufferStart + duration

  // Treat meetings and project activity blocks as the same kind of fixed
  // commitment for buffer placement.
  const blockers = [...meetings, ...projectActivity]

  const conflictingBlocker = blockers.find(blocker => {
    const blockerStart = new Date(blocker.start_time)
    const blockerEnd = new Date(blocker.end_time)
    const blockerDateStr = format(blockerStart, 'yyyy-MM-dd')

    if (blockerDateStr !== dateStr) return false

    const blockerStartMinutes = blockerStart.getHours() * 60 + blockerStart.getMinutes()
    const blockerEndMinutes = blockerEnd.getHours() * 60 + blockerEnd.getMinutes()

    // Check if blocker overlaps with buffer time
    return (blockerStartMinutes < bufferEnd && blockerEndMinutes > bufferStart)
  })

  // If there's a conflict, position buffer after the blocker
  if (conflictingBlocker) {
    const blockerEnd = new Date(conflictingBlocker.end_time)
    const meetingEndMinutes = blockerEnd.getHours() * 60 + blockerEnd.getMinutes()
    
    // Position buffer to start after meeting ends
    const newStartMinutes = meetingEndMinutes
    const newStartHour = Math.floor(newStartMinutes / 60)
    const newStartMinute = newStartMinutes % 60
    
    // Don't schedule buffer too late (before 11 PM)
    if (newStartHour >= 23) {
      return null
    }
    
    startHour = newStartHour
    const startMinute = newStartMinute
    
    const buffer: BufferTime = {
      id: `buffer-${dateStr}`,
      title: 'Buffer Time',
      startTime: `${startHour.toString().padStart(2, '0')}:${startMinute.toString().padStart(2, '0')}`,
      endTime: `${Math.floor((newStartMinutes + duration) / 60).toString().padStart(2, '0')}:${((newStartMinutes + duration) % 60).toString().padStart(2, '0')}`,
      duration,
      date,
      dateStr,
      isBuffer: true,
      isReduced,
      isActive: true
    }
    
    return buffer
  }
  
  const startMinutes = Math.round(startHour * 60)
  const sH = Math.floor(startMinutes / 60)
  const sM = startMinutes % 60
  const buffer: BufferTime = {
    id: `buffer-${dateStr}`,
    title: 'Buffer Time',
    startTime: `${sH.toString().padStart(2, '0')}:${sM.toString().padStart(2, '0')}`,
    endTime: `${Math.floor((startMinutes + duration) / 60).toString().padStart(2, '0')}:${((startMinutes + duration) % 60).toString().padStart(2, '0')}`,
    duration,
    date,
    dateStr,
    isBuffer: true,
    isReduced,
    isActive: true
  }
  
  return buffer
}

export const generateBuffersForDays = (dayColumns: any[], meetings: any[] = [], projectActivity: any[] = []): Map<string, BufferTime> => {
  const buffers = new Map<string, BufferTime>()

  dayColumns.forEach(dayColumn => {
    const buffer = generateDailyBuffer(dayColumn.date, meetings, projectActivity)
    if (buffer) {
      buffers.set(dayColumn.dateStr, buffer)
    }
  })

  return buffers
}

export const getBuffersForTimeSlot = (
  timeSlot: string, 
  date: Date, 
  buffers: Map<string, BufferTime>
): BufferTime[] => {
  const dateStr = format(date, 'yyyy-MM-dd')
  const currentHour = parseInt(timeSlot.split(':')[0])
  const buffer = buffers.get(dateStr)
  
  if (!buffer || !buffer.isActive) return []
  
  const bufferStartHour = parseInt(buffer.startTime.split(':')[0])
  
  // Hide anything before 6 AM (consistent with other calendar items)
  if (bufferStartHour < 6) return []
  
  if (bufferStartHour === currentHour) {
    const minutes = parseInt(buffer.startTime.split(':')[1])
    return [{
      ...buffer,
      topPosition: (minutes / 60) * 100
    }]
  }
  
  return []
}