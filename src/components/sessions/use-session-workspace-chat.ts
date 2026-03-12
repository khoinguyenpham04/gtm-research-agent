"use client"

import { DefaultChatTransport } from "ai"
import { useChat } from "@ai-sdk/react"
import { startTransition, useCallback, useState } from "react"

import {
  workspaceChatMessageMetadataSchema,
  type WorkspaceChatUIMessage,
} from "@/lib/deep-research/types"

export function useSessionWorkspaceChat({
  onPersisted,
  sessionId,
}: {
  sessionId: string
  onPersisted: () => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)

  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
  } = useChat<WorkspaceChatUIMessage>({
    id: sessionId,
    generateId: () => crypto.randomUUID(),
    messageMetadataSchema: workspaceChatMessageMetadataSchema,
    onError: (nextError) => {
      setError(nextError.message)
      void onPersisted().finally(() => {
        startTransition(() => {
          setMessages([])
        })
      })
    },
    onFinish: ({ isAbort }) => {
      if (isAbort) {
        return
      }

      setError(null)
      void onPersisted().finally(() => {
        startTransition(() => {
          setMessages([])
        })
      })
    },
    transport: new DefaultChatTransport({
      api: `/api/sessions/${sessionId}/chat`,
    }),
  })

  const sendWorkspaceMessage = useCallback(
    async ({
      selectedDocumentIds,
      text,
    }: {
      selectedDocumentIds: string[]
      text: string
    }) => {
      setError(null)
      await sendMessage(
        {
          text,
        },
        {
          body: {
            selectedDocumentIds,
          },
        },
      )
    },
    [sendMessage],
  )

  return {
    chatError: error,
    chatMessages: messages,
    chatStatus: status,
    sendWorkspaceMessage,
    stopWorkspaceMessage: stop,
  }
}
