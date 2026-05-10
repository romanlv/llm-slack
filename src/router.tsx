import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { AppShell } from '@/app/app-shell'
import { ChatPage } from '@/pages/chat-page'
import { ChatThreadPage } from '@/pages/chat-thread-page'
import { ChatsPage } from '@/pages/chats-page'
import { HomePage } from '@/pages/home-page'
import { ProfilePage } from '@/pages/profile-page'
import { SavedMessagesPage } from '@/pages/saved-messages-page'
import { SettingsPage } from '@/pages/settings-page'

const rootRoute = createRootRoute({
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$chatId',
  component: ChatPage,
})

const chatThreadRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$chatId/thread/$threadId',
  component: ChatThreadPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
})

const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: ProfilePage,
})

const savedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/saved',
  component: SavedMessagesPage,
})

const chatsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chats',
  component: ChatsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  chatRoute,
  chatThreadRoute,
  chatsRoute,
  profileRoute,
  savedRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
