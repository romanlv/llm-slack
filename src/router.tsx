import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'

import { AppShell } from '@/app/app-shell'
import { ChatShell } from '@/app/chat-shell'
import { SettingsShell } from '@/features/settings/settings-shell'
import { ChatPage } from '@/pages/chat-page'
import { ChatThreadPage } from '@/pages/chat-thread-page'
import { ChatsPage } from '@/pages/chats-page'
import { HomePage } from '@/pages/home-page'
import { ModelsPage } from '@/pages/models-page'
import { PreferencesPage } from '@/pages/preferences-page'
import { ProfilePage } from '@/pages/profile-page'
import { SavedMessagesPage } from '@/pages/saved-messages-page'
import { SettingsAgentsPage } from '@/pages/settings-agents-page'
import { SettingsPage } from '@/pages/settings-page'

// AppShell is the root layer. ChatShell and SettingsShell are pathless
// sibling layouts that own their respective sidebars — a route belongs to
// exactly one of them, so the two sidebars never render simultaneously.
const rootRoute = createRootRoute({
  component: AppShell,
})

const chatLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_chat-shell',
  component: ChatShell,
})

const indexRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '/',
  component: HomePage,
})

const chatRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '/chat/$chatId',
  component: ChatPage,
})

const chatThreadRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '/chat/$chatId/thread/$threadId',
  component: ChatThreadPage,
})

const chatsRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '/chats',
  component: ChatsPage,
})

const savedRoute = createRoute({
  getParentRoute: () => chatLayoutRoute,
  path: '/saved',
  component: SavedMessagesPage,
})

const settingsLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_settings-shell',
  component: SettingsShell,
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: '/settings',
  beforeLoad: () => {
    throw redirect({ to: '/settings/providers' })
  },
})

const settingsProvidersRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: '/settings/providers',
  component: SettingsPage,
})

const settingsModelsRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: '/settings/models',
  component: ModelsPage,
})

const settingsAgentsRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: '/settings/agents',
  component: SettingsAgentsPage,
})

const settingsProfileRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: '/settings/profile',
  component: ProfilePage,
})

const settingsPreferencesRoute = createRoute({
  getParentRoute: () => settingsLayoutRoute,
  path: '/settings/preferences',
  component: PreferencesPage,
})

// Legacy /profile URL — keep working but funnel users into the new home.
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile' })
  },
})

const routeTree = rootRoute.addChildren([
  chatLayoutRoute.addChildren([
    indexRoute,
    chatRoute,
    chatThreadRoute,
    chatsRoute,
    savedRoute,
  ]),
  settingsLayoutRoute.addChildren([
    settingsIndexRoute,
    settingsProvidersRoute,
    settingsModelsRoute,
    settingsAgentsRoute,
    settingsProfileRoute,
    settingsPreferencesRoute,
  ]),
  profileRoute,
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
