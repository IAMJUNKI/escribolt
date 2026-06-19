import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import StickyApp from './StickyApp';
import DashboardApp from './DashboardApp';
import ProcessingModeWidget from './ProcessingModeWidget';

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

const { hash } = window.location;
const isSticky = hash.startsWith('#sticky');
const isDashboard = hash.startsWith('#dashboard');
const isProcessingWidget = hash.startsWith('#processing-widget');

root.render(
    <React.StrictMode>
        {isDashboard ? <DashboardApp /> : (isProcessingWidget ? <ProcessingModeWidget /> : (isSticky ? <StickyApp /> : <App />))}
    </React.StrictMode>
);
