import { after } from "next/server"

export function scheduleDeepResearchTask(
  task: () => Promise<void>,
  errorLabel: string,
) {
  const runTask = async () => {
    try {
      await task()
    } catch (error) {
      console.error(errorLabel, error)
    }
  }

  if (process.env.NODE_ENV === "development") {
    void Promise.resolve().then(runTask)
    return
  }

  after(runTask)
}
