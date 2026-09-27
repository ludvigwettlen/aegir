import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import { App } from './ui/App';
import '@usefragments/ui/styles';
import './ui/styles.css';
import './ui/light.scss';
import './ui/task-layout.scss';
import './ui/design-system/tokens.scss';
import './ui/design-system/chat.scss';
import './ui/design-system/primitives.scss';
import './ui/design-system/tasks.scss';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider defaultMode="light"><App /></ThemeProvider></React.StrictMode>);
