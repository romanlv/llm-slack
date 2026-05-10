import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Camera, ImageOff } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  DEFAULT_SETTINGS,
  DEFAULT_USER_NAME,
  getSettings,
  saveSettings,
  userInitials,
} from '@/features/settings/settings-repository'

const MAX_AVATAR_BYTES = 2 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Could not read image file.'))
    })
    reader.addEventListener('error', () => reject(new Error('Could not read image file.')))
    reader.readAsDataURL(file)
  })
}

export function ProfilePageContent() {
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS)
  const [savedMessage, setSavedMessage] = useState('')
  const [imageError, setImageError] = useState('')

  const showSaved = (message = 'Profile saved locally in IndexedDB.') => {
    setSavedMessage(message)
    window.setTimeout(() => setSavedMessage(''), 2500)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)

    await saveSettings({
      userName: String(formData.get('userName') ?? ''),
    })
    showSaved()
  }

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    if (!file.type.startsWith('image/')) {
      setImageError('Choose an image file.')
      return
    }

    if (file.size > MAX_AVATAR_BYTES) {
      setImageError('Choose an image smaller than 2 MB.')
      return
    }

    setImageError('')
    const avatarDataUrl = await readFileAsDataUrl(file)
    await saveSettings({ avatarDataUrl })
    showSaved('Profile picture updated.')
  }

  const handleRemoveAvatar = async () => {
    setImageError('')
    await saveSettings({ avatarDataUrl: undefined })
    showSaved('Profile picture removed.')
  }

  return (
    <div className="p-6 md:p-10">
      <CardHeader className="px-0 pt-0">
        <Badge>Profile</Badge>
        <CardTitle className="text-3xl">Your local profile</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          Your name and picture are stored in this browser and used to label your messages.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid max-w-3xl gap-6 px-0 pb-0">
        <section className="flex flex-col gap-4 sm:flex-row sm:items-center">
          {settings.avatarDataUrl ? (
            <img
              alt={`${settings.userName} avatar`}
              className="size-24 rounded-md border border-line object-cover"
              src={settings.avatarDataUrl}
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-md border border-line bg-yellow font-mono text-2xl font-black text-sidebar">
              {userInitials(settings.userName)}
            </div>
          )}

          <div className="grid gap-2">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-small font-semibold text-ink transition hover:bg-surface-muted">
              <Camera className="size-4" />
              Change picture
              <input
                accept="image/*"
                className="sr-only"
                onChange={(event) => void handleAvatarChange(event)}
                type="file"
              />
            </label>
            <Button
              className="w-fit rounded-md"
              disabled={!settings.avatarDataUrl}
              onClick={() => void handleRemoveAvatar()}
              type="button"
              variant="outline"
            >
              <ImageOff className="size-4" />
              Remove picture
            </Button>
            {imageError ? <p className="text-sm text-danger">{imageError}</p> : null}
          </div>
        </section>

        <form
          className="grid gap-4"
          key={settings.userName}
          onSubmit={handleSubmit}
        >
          <label className="grid gap-2">
            <span className="text-sm font-medium text-foreground">User name</span>
            <Input
              autoComplete="name"
              defaultValue={settings.userName}
              name="userName"
              placeholder={DEFAULT_USER_NAME}
            />
          </label>

          <div className="flex items-center gap-3">
            <Button type="submit">Save profile</Button>
            {savedMessage ? (
              <p className="text-sm text-muted-foreground">{savedMessage}</p>
            ) : null}
          </div>
        </form>
      </CardContent>
    </div>
  )
}
