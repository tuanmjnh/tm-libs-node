namespace System {
  export interface ITask {
    command: string
    args?: string[]
    options?: any
    meta?: T
    timeout?: number
  }
}
