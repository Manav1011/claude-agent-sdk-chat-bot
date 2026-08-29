import React, { useState, useEffect } from 'react';
import { ChatProvider, useChat } from './context/ChatContext';
import { verifyPasswordApi } from './utils/api';
import Sidebar from './components/Sidebar/Sidebar';
import Header from './components/Header/Header';
import TabBar from './components/Header/TabBar';
import MessagesContainer from './components/Chat/MessagesContainer';
import ChatInput from './components/Input/ChatInput';
import SelectionPopup from './components/Chat/SelectionPopup';
import SettingsModal from './components/Modals/SettingsModal';
import ContextModal from './components/Modals/ContextModal';
import ImageLightboxModal from './components/Modals/ImageLightboxModal';
import NotificationToast from './components/Notifications/NotificationToast';

function AppContent() {
  return (
    <div className="flex h-full h-[100dvh] max-h-[100dvh] w-full bg-ambient relative overflow-hidden">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0 h-full max-h-full relative overflow-hidden">
        <TabBar />
        <Header />
        <MessagesContainer />
        <ChatInput />
        <SelectionPopup />
      </main>
      <SettingsModal />
      <ContextModal />
      <ImageLightboxModal />
      <NotificationToast />
    </div>
  );
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (isAuthenticated) return;
    let isMounted = true;

    async function promptPassword() {
      while (isMounted) {
        const input = window.prompt('Please enter the password to access:');
        if (input === null) {
          window.alert('Password is required to access.');
          continue;
        }
        try {
          const isValid = await verifyPasswordApi(input);
          if (isValid) {
            if (isMounted) setIsAuthenticated(true);
            break;
          } else {
            window.alert('Incorrect password. Please try again.');
          }
        } catch {
          window.alert('Verification failed. Please try again.');
        }
      }
    }

    promptPassword();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  );
}

