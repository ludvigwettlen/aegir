import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import { App } from './ui/App';
import './ui/styles';

// Glass step 2: in a macOS glass window the frame is transparent, so the desktop shows through (html.ws-vibrant).
if (window.aegir?.windowVibrancy) document.documentElement.classList.add('ws-vibrant');
createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider defaultMode="light"><App /></ThemeProvider></React.StrictMode>);
