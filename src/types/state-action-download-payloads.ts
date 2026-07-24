export interface RemoveDownloadTaskPayload {
  taskId: string
}

export interface CancelDownloadTaskPayload {
  taskId: string
}

export interface ResumeDestinationTaskPayload {
  taskId: string
}

export interface UndoPendingActionPayload {
  token: string
}
