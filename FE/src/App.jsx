import React from 'react';
import { ChatProvider, useChat } from './context/ChatContext';
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
  return (
    <ChatProvider>
      <AppContent />
    </ChatProvider>
  );
}
