import { spawn, ChildProcessWithoutNullStreams } from "child_process"

export const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

export class TaskProcessManager {
  private totalThreads: number
  private sleep: number
  private tasks: System.ITask[] = []
  private taskGroups: System.ITask[][] = []
  private children: Map<string, ChildProcessWithoutNullStreams> = new Map()
  private isProcessing = false
  private threads: (string | null)[] = []
  private processing: string[] = []
  private processed: string[] = []

  // Callbacks
  public onTaskStdout?: (taskKey: string, task: System.ITask, thread: number, data: Buffer) => void
  public onTaskStderr?: (taskKey: string, task: System.ITask, thread: number, data: Buffer) => void
  public onTaskDone?: (taskKey: string, task: System.ITask) => void | Promise<void>
  public onTaskError?: (
    taskKey: string,
    task: System.ITask,
    thread: number,
    code: number | null,
    signal: NodeJS.Signals | null,
    stdout: string,
    stderr: string
  ) => void | Promise<void>
  public onAllTasksDone?: (total: number) => void | Promise<void>

  // Hooks
  public beforeRunTask?: (taskKey: string, task: System.ITask, thread: number) => void | Promise<void>
  public afterRunTask?: (taskKey: string,
    task: System.ITask,
    thread: number,
    code: number | null,
    signal: NodeJS.Signals | null,
    stdout: string,
    stderr: string) => void | Promise<void>

  constructor(threads = 1, sleep = 200) {
    this.totalThreads = threads
    this.sleep = sleep
    this.threads = Array(this.totalThreads).fill(null)
  }

  // --- Task setters ---
  public setTasks(tasks: System.ITask[]) {
    this.tasks = tasks
    this.taskGroups = []
    this.reset()
  }

  public setGroupedTasks(groups: System.ITask[][]) {
    this.taskGroups = groups
    this.tasks = []
    this.reset()
  }

  // --- Getters ---
  public getTasks() {
    return this.tasks
  }

  public getGroupedTasks() {
    return this.taskGroups
  }

  private reset() {
    this.children.clear()
    this.threads = Array(this.totalThreads).fill(null)
    this.processing = []
    this.processed = []
  }

  // --- Start ---
  public async start() {
    try {
      if (this.isProcessing) return
      this.isProcessing = true

      if (this.taskGroups.length > 0) {
        await this.runGroups()
      } else {
        await this.runTasks()
      }

      this.isProcessing = false

      if (this.onAllTasksDone) {
        const total = this.taskGroups.length > 0 ? this.taskGroups.length : this.tasks.length
        await this.onAllTasksDone(total)
      }
    } catch (error) {
      throw error
    }
  }

  // --- Run tasks in parallel ---
  private async runTasks() {
    while (this.isProcessing && this.processed.length < this.tasks.length) {
      for (let t = 0; t < this.totalThreads; t++) {
        if (this.threads[t] !== null) continue

        const nextIdx = this.tasks.findIndex((_, i) => !this.processing.includes(String(i)) && !this.processed.includes(String(i)))
        if (nextIdx === -1) continue

        const taskKey = String(nextIdx)
        this.threads[t] = taskKey
        this.processing.push(taskKey)

        this.spawnTask(t, taskKey, this.tasks[nextIdx])
      }

      await delay(this.sleep)
    }
  }

  // --- Run groups: groups run in parallel by threads, tasks inside group run sequentially ---
  private async runGroups() {
    while (this.isProcessing && this.processed.length < this.taskGroups.length) {
      for (let t = 0; t < this.totalThreads; t++) {
        if (this.threads[t] !== null) continue

        const nextIdx = this.taskGroups.findIndex((_, i) => !this.processing.includes(String(i)) && !this.processed.includes(String(i)))
        if (nextIdx === -1) continue

        const groupKey = String(nextIdx)
        this.threads[t] = groupKey
        this.processing.push(groupKey)

        this.runGroupTasks(t, groupKey, this.taskGroups[nextIdx])
      }

      await delay(this.sleep)
    }
  }

  private async runGroupTasks(thread: number, groupKey: string, group: System.ITask[]) {
    for (const [tIdx, task] of group.entries()) {
      if (!this.isProcessing) break
      const taskKey = `${groupKey}-${tIdx}`
      await this.spawnTask(thread, taskKey, task, true) // sequential
    }

    // mark group done
    this.processing = this.processing.filter(k => k !== groupKey)
    if (!this.processed.includes(groupKey)) this.processed.push(groupKey)
    this.threads[thread] = null
  }

  // --- Spawn a single task ---
  private async spawnTask(thread: number, taskKey: string, task: System.ITask, wait = false): Promise<void> {
    if (this.beforeRunTask) {
      await this.beforeRunTask(taskKey, task, thread)
    }

    return new Promise((resolve) => {
      const child = spawn(task.command, task.args || [], task.options || {})
      this.children.set(taskKey, child)

      let stderr = ""
      let stdout = ""
      child.stdout.on("data", (data) => {
        stdout += data.toString()
        this.onTaskStdout?.(taskKey, task, thread, data)
      })

      child.stderr.on("data", (data) => {
        stderr += data.toString()
        this.onTaskStderr?.(taskKey, task, thread, data)
      })

      child.on("close", async (code, signal) => {
        this.children.delete(taskKey)

        if (code === 0) {
          await this.onTaskDone?.(taskKey, task)
        } else {
          await this.onTaskError?.(taskKey, task, thread, code, signal, stdout, stderr)
        }

        if (this.afterRunTask) {
          await this.afterRunTask(taskKey, task, thread, code, signal, stdout, stderr)
        }

        // mark task done
        if (!this.processed.includes(taskKey)) this.processed.push(taskKey)
        this.processing = this.processing.filter(k => k !== taskKey)

        if (!wait) {
          this.threads[thread] = null
        }

        resolve()
      })

      if (!wait) {
        // non-blocking run (parallel mode)
        // don't resolve here, only resolve in close
      }
    })
  }

  // --- Stop all ---
  public stop(signal: NodeJS.Signals = "SIGTERM") {
    this.isProcessing = false
    for (const [, child] of this.children.entries()) {
      child.kill(signal)
    }
    this.children.clear()
  }

  // --- Stop one task ---
  public stopTask(taskKey: string, signal: NodeJS.Signals = "SIGTERM") {
    const child = this.children.get(taskKey)
    if (child) {
      child.kill(signal)
      this.children.delete(taskKey)
      this.processing = this.processing.filter(k => k !== taskKey)
      this.threads = this.threads.map(t => (t === taskKey ? null : t))
    }
  }

  // --- Destroy everything ---
  public destroy(signal: NodeJS.Signals = "SIGTERM") {
    this.stop(signal)
    this.tasks = []
    this.taskGroups = []
  }
}
