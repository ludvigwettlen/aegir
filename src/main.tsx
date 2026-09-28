import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@usefragments/ui';
import { App } from './ui/App';
import './ui/styles';

createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider defaultMode="light"><App /></ThemeProvider></React.StrictMode>);
