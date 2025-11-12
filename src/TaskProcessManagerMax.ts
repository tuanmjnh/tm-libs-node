import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
export const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

export class TaskProcessManagerMax {
  private totalThreads: number = 1
  private sleep: number = 200
  private tasks: System.ITask[] = []
  private taskGroups: System.ITask[][] = [] // ✅ pipeline support
  private threads: (number | null)[] = []
  private processing: number[] = []
  private processed: number[] = []
  private isProcessing: boolean = false
  private isPaused: boolean = false
  private children: Map<number, ChildProcessWithoutNullStreams> = new Map()
  private retryCount: Record<number, number> = {}
  private timeouts: Record<number, NodeJS.Timeout> = {}
  public maxRetry: number = 2
  public defaultTimeout: number = 1 * 60 * 1000 // 1 Minutes
  public retryDelay: number = 1000
  public globalRetryLimit: number = 100
  private globalRetryCount: number = 0
  private taskStatus: Record<number, string> = {}
  public logLevel: "info" | "warn" | "error" | "debug" = "info"
  public killSignal: NodeJS.Signals = 'SIGTERM'

  private log(level: "info" | "warn" | "error" | "debug", msg: string, data?: any) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 }
    if (this.onLog && levels[level] >= levels[this.logLevel]) {
      this.onLog(`[${level.toUpperCase()}] ${msg}`, data)
    }
  }

  // Callbacks
  public beforeStart?: (tasks: System.ITask[]) => void | Promise<void>
  public afterStart?: () => void | Promise<void>
  public beforeStop?: () => void | Promise<void>
  public afterStop?: () => void | Promise<void>
  public beforePause?: () => void | Promise<void>
  public afterPause?: () => void | Promise<void>
  public beforeRunTask?: (thread: number, index: number, task: System.ITask) => void | Promise<void>
  public afterRunTask?: (pid: number | undefined, thread: number, index: number, task: System.ITask, code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string) => void | Promise<void>
  public beforeStopTask?: (index: number, task: System.ITask) => void | Promise<void>
  public afterStopTask?: (index: number, task: System.ITask) => void | Promise<void>
  public onStopTask?: (index: number, task: System.ITask) => void | Promise<void>
  public onTaskStdout?: (thread: number, index: number, task: System.ITask, data: Buffer) => void
  public onTaskStderr?: (thread: number, index: number, task: System.ITask, data: Buffer) => void
  public onTasksRunning?: (processing: number[], processed: number[], threads: (number | null)[]) => void | Promise<void>
  public onAllTasksDone?: (total: number) => void | Promise<void>
  public onDestroy?: () => void | Promise<void>
  public onTaskError?: (thread: number, index: number, task: System.ITask, code: number | null, signal: NodeJS.Signals | null, stderr: string) => void | Promise<void>
  public onLog?: (msg: string, data?: any) => void
  public onTaskTimeout?: (index: number, task: System.ITask) => void | Promise<void>
  public onTaskRetry?: (index: number, retryCount: number) => void | Promise<void>
  public onTaskDone?: (index: number, task: System.ITask) => void | Promise<void>
  public onGroupDone?: (groupIdx: number, group: System.ITask[]) => void | Promise<void> // ✅ callback for group

  constructor(threads = 1, sleep = 100, maxRetry = 0, timeout = 10 * 60 * 1000, killSignal: NodeJS.Signals = 'SIGTERM') {
    this.totalThreads = threads
    this.sleep = sleep
    this.maxRetry = maxRetry
    this.defaultTimeout = timeout
    this.killSignal = killSignal
    this.threads = Array(this.totalThreads).fill(null)
  }

  private resetState() {
    this.processed = []
    this.processing = []
    this.threads = Array(this.totalThreads).fill(null)
    this.children.clear()
    this.retryCount = {}
    Object.values(this.timeouts).forEach(clearTimeout)
    this.timeouts = {}
    this.taskStatus = {}
  }

  public setTasks(tasks: System.ITask[]) {
    this.tasks = tasks
    this.taskGroups = [] // reset groups
    this.resetState()
    tasks.forEach((_, i) => this.taskStatus[i] = "waiting")
  }

  public setGroupedTasks(groups: System.ITask[][]) {
    this.taskGroups = groups
    this.tasks = [] // reset single tasks
    this.resetState()
  }

  public getTasks() {
    return this.tasks
  }

  public getGroupTasks() {
    return this.taskGroups
  }

  public async start() {
    if (this.isProcessing) {
      this.log("warn", "Task manager is already running.")
      throw new Error("Task manager is already running.")
    }
    if (this.beforeStart) await this.beforeStart(this.tasks)
    this.isProcessing = true
    this.isPaused = false
    this.threads = Array(this.totalThreads).fill(null)
    if (this.afterStart) await this.afterStart()
    if (this.taskGroups.length > 0) {
      await this.runGroups()
    } else {
      await this.runSingle()
    }
  }

  public async stop(signal: NodeJS.Signals = this.killSignal) {
    if (this.beforeStop) await this.beforeStop()
    this.isProcessing = false
    this.isPaused = false
    for (const [idx, child] of this.children.entries()) {
      child.kill(signal)
    }
    this.children.clear()
    // Clear all timeouts
    Object.values(this.timeouts).forEach(clearTimeout)
    this.timeouts = {}
    this.processing = []
    this.processed = []
    this.threads = Array(this.totalThreads).fill(null)
    if (this.afterStop) await this.afterStop()
  }

  public async stopTask(index: number, signal: NodeJS.Signals = this.killSignal) {
    const task = this.tasks[index]
    if (this.beforeStopTask) await this.beforeStopTask(index, task)
    const child = this.children.get(index)
    if (child) {
      child.kill(signal)
      this.children.delete(index)
      this.processing = this.processing.filter(idx => idx !== index)
      this.threads = this.threads.map(t => (t === index ? null : t))
      if (!this.processed.includes(index)) this.processed.push(index)
    }
    if (this.afterStopTask) await this.afterStopTask(index, task)
    if (this.onStopTask) await this.onStopTask(index, task)
    this.taskStatus[index] = "stopped"
    this.log("info", "Stop task", { idx: index })
  }

  public async pause() {
    if (this.beforePause) await this.beforePause()
    this.isPaused = true
    if (this.afterPause) await this.afterPause()
  }

  public async continue() {
    if (!this.isPaused || this.isProcessing) return
    this.isPaused = false
    this.isProcessing = true
    await this.runSingle()
  }

  public cancelTask(index: number) {
    if (this.processing.includes(index)) return
    this.tasks[index] = null as any
    this.taskStatus[index] = "cancelled"
    this.log("info", "Cancel task", { idx: index })
  }

  private async runSingle() {
    while (this.isProcessing && this.processed.length < this.tasks.length) {
      if (this.isPaused) {
        await delay(this.sleep)
        continue
      }
      if (this.onTasksRunning) await this.onTasksRunning(this.processing, this.processed, this.threads)
      for (let t = 0; t < this.totalThreads; t++) {
        if (this.threads[t] !== null) continue
        const nextIdx = this.tasks.findIndex((task, i) =>
          task && !this.processing.includes(i) && !this.processed.includes(i) && this.taskStatus[i] !== "cancelled"
        )
        if (nextIdx === -1) continue
        this.threads[t] = nextIdx
        this.processing.push(nextIdx)
        this.taskStatus[nextIdx] = "running"
        const task = this.tasks[nextIdx]
        if (this.beforeRunTask) await this.beforeRunTask(t, nextIdx, task)
        this.log("info", 'Start task', { idx: nextIdx, task })

        const child = spawn(task.command, task.args || [], task.options || {})
        this.children.set(nextIdx, child)

        const timeoutMs = task.timeout ?? this.defaultTimeout
        this.timeouts[nextIdx] = setTimeout(() => {
          this.taskStatus[nextIdx] = "timeout"
          if (this.onTaskTimeout) this.onTaskTimeout(nextIdx, task)
          if (this.children.has(nextIdx)) {
            child.kill(this.killSignal)
            this.log("warn", 'Task timeout', { idx: nextIdx, timeoutMs })
          }
        }, timeoutMs)

        let stdout = ''
        child.stdout.on('data', (data) => {
          stdout += data.toString()
          if (this.onTaskStdout) this.onTaskStdout(t, nextIdx, task, data)
        })
        let stderr = ''
        child.stderr.on('data', (data) => {
          stderr += data.toString()
          if (this.onTaskStderr) this.onTaskStderr(t, nextIdx, task, data)
        })
        child.on('close', async (code, signal) => {
          clearTimeout(this.timeouts[nextIdx])
          delete this.timeouts[nextIdx]
          this.children.delete(nextIdx)
          this.processing = this.processing.filter(idx => idx !== nextIdx)
          if (!this.processed.includes(nextIdx)) this.processed.push(nextIdx)
          this.threads[t] = null
          if (this.afterRunTask) await this.afterRunTask(child?.pid, t, nextIdx, task, code, signal, stdout, stderr)
          if (this.onStopTask) await this.onStopTask(nextIdx, task)
          if (this.onTaskError && code !== 0) await this.onTaskError(t, nextIdx, task, code, signal, stderr)
          if (code === 0) {
            this.taskStatus[nextIdx] = "done"
            this.log("info", "Task done", { idx: nextIdx })
            if (this.onTaskDone) await this.onTaskDone(nextIdx, task)
          } else {
            this.taskStatus[nextIdx] = "failed"
            this.retryCount[nextIdx] = (this.retryCount[nextIdx] || 0) + 1
            this.globalRetryCount++
            if (this.retryCount[nextIdx] <= this.maxRetry && this.globalRetryCount <= this.globalRetryLimit) {
              this.log("warn", 'Retry task', { idx: nextIdx, retry: this.retryCount[nextIdx] })
              if (this.onTaskRetry) await this.onTaskRetry(nextIdx, this.retryCount[nextIdx])
              this.processed = this.processed.filter(idx => idx !== nextIdx)
              setTimeout(() => {
                if (this.isProcessing) this.runSingle()
              }, this.retryDelay)
            } else if (this.globalRetryCount > this.globalRetryLimit) {
              this.isProcessing = false
              this.log("error", 'Global retry limit reached, stopping all tasks', { globalRetryCount: this.globalRetryCount })
            } else {
              this.log("error", 'Task failed after max retry', { idx: nextIdx })
            }
          }
        })
      }
      await delay(this.sleep)
    }
    this.isProcessing = false
    if (this.onAllTasksDone) await this.onAllTasksDone(this.tasks.length)
  }

  // ✅ run a task in a group
  private runSingleTask(gIdx: number, tIdx: number, task: System.ITask): Promise<void> {
    return new Promise((resolve) => {
      const child = spawn(task.command, task.args || [], task.options || {})
      this.log("info", `Run group ${gIdx} task ${tIdx}`, task)

      let stdout = ""
      let stderr = ""

      child.stdout.on("data", (data) => {
        stdout += data.toString()
        this.onTaskStdout?.(gIdx, tIdx, task, data)
      })
      child.stderr.on("data", (data) => {
        stderr += data.toString()
        this.onTaskStderr?.(gIdx, tIdx, task, data)
      })
      child.on("close", async (code, signal) => {
        if (code === 0) {
          this.taskStatus[tIdx] = "done"
          await this.onTaskDone?.(tIdx, task)
        } else {
          this.taskStatus[tIdx] = "failed"
          await this.onTaskError?.(gIdx, tIdx, task, code, signal, stderr)
        }
        resolve()
      })
    })
  }

  // ✅ Run each group sequentially, but multiple groups in parallel
  private async runGroups() {
    await Promise.all(
      this.taskGroups.map(async (group, gIdx) => {
        for (const [tIdx, task] of group.entries()) {
          if (!this.isProcessing) break
          await this.runSingleTask(gIdx, tIdx, task)
        }
        if (this.onGroupDone) await this.onGroupDone(gIdx, group)
      })
    )
    this.isProcessing = false
    if (this.onAllTasksDone) await this.onAllTasksDone(this.taskGroups.length)
  }

  public async destroy(signal: NodeJS.Signals = this.killSignal) {
    this.isProcessing = false
    this.isPaused = false
    for (const [idx, child] of this.children.entries()) {
      child.kill(signal)
    }
    this.children.clear()
    // Clear all timeouts
    Object.values(this.timeouts).forEach(clearTimeout)
    this.timeouts = {}
    this.tasks = []
    this.threads = []
    this.processing = []
    this.processed = []
    if (this.onDestroy) await this.onDestroy()
  }

  public getProcessing() {
    return this.processing
  }

  public getProcessed() {
    return this.processed
  }

  public getThreads() {
    return this.threads
  }

  public isRunning() {
    return this.isProcessing
  }

  public isPause() {
    return this.isPaused
  }

  public getStatus() {
    return {
      total: this.tasks.length,
      running: this.processing.length,
      done: this.processed.length,
      waiting: this.tasks.length - this.processing.length - this.processed.length,
      retryCount: { ...this.retryCount },
      globalRetryCount: this.globalRetryCount,
      taskStatus: { ...this.taskStatus }
    }
  }
}
