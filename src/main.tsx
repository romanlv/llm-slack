import { StrictMode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'

import './index.css'
import { router } from './router.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
