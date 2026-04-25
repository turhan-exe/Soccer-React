import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useInventory } from '@/contexts/InventoryContext';
import { sendGlobalChatMessage, subscribeToGlobalChat } from '@/services/chat';
import type { GlobalChatMessage } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/contexts/LanguageContext';

const MAX_MESSAGE_LENGTH = 320;
const CHAT_ADMIN_REDIRECT_EMAIL = 'ops.lead@mgx.gg';

const formatTime = (value: Date) =>
  value.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });

const GlobalChatWidget: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { vipActive } = useInventory();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<GlobalChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const [gradientStart, setGradientStart] = useState('#0ea5e9');
  const [gradientEnd, setGradientEnd] = useState('#9333ea');
  const [showAdminDialog, setShowAdminDialog] = useState(false);
  const { t } = useTranslation();
  const shouldRedirectToAdmin =
    user?.email?.toLowerCase().trim() === CHAT_ADMIN_REDIRECT_EMAIL;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    setIsLoading(true);
    setErrorMessage(null);
    const unsubscribe = subscribeToGlobalChat(
      payload => {
        setMessages(payload);
        setIsLoading(false);
      },
      error => {
        setIsLoading(false);
        setErrorMessage('Sohbet akisi yuklenemedi. Lutfen tekrar deneyin.');
        console.warn('[GlobalChatWidget] subscription failed', error);
      },
    );

    return () => unsubscribe();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !scrollAreaRef.current) {
      return;
    }
    const node = scrollAreaRef.current;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [messages, isOpen]);

  const handleSend = useCallback(async () => {
    if (!user) {
      setErrorMessage('Oturum actiktan sonra mesaj gonderebilirsiniz.');
      return;
    }
    const trimmed = inputValue.trim();
    if (!trimmed) {
      return;
    }
    setIsSending(true);
    setErrorMessage(null);
    try {
      const gradientAngle = Math.floor(Math.random() * 360);
      await sendGlobalChatMessage({
        text: trimmed,
        userId: user.id,
        username: user.username || user.teamName,
        teamName: user.teamName || 'Takimim',
        isVip: vipActive,
        gradientStart: vipActive ? gradientStart : undefined,
        gradientEnd: vipActive ? gradientEnd : undefined,
        gradientAngle: vipActive ? gradientAngle : undefined,
      });
      setInputValue('');
    } catch (error) {
      console.warn('[GlobalChatWidget] send failed', error);
      const rawMessage =
        error instanceof Error ? error.message : 'Mesaj gonderilemedi. Lutfen tekrar deneyin.';
      const friendlyMessage = rawMessage.includes('Missing or insufficient permissions')
        ? 'Sohbet yetkiniz yok veya timeout devam ediyor.'
        : rawMessage;
      setErrorMessage(friendlyMessage);
    } finally {
      setIsSending(false);
    }
  }, [gradientEnd, gradientStart, inputValue, user, vipActive]);

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      void handleSend();
    },
    [handleSend],
  );

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const remainingCharacters = MAX_MESSAGE_LENGTH - inputValue.length;
  const buttonLabel = isOpen ? 'Sohbeti Kapat' : 'Sohbet';
  const subtitleText = isOpen
    ? 'Mesajlar en fazla 1 hafta boyunca tutulur.'
    : 'Lig menajerleriyle sohbet et.';

  const handleToggle = useCallback(() => {
    if (shouldRedirectToAdmin) {
      setShowAdminDialog(true);
      return;
    }

    setIsOpen(prev => !prev);
  }, [shouldRedirectToAdmin]);

  const renderedMessages = useMemo(() => {
    if (!messages.length) {
      return (
        <p className="nostalgia-chat-panel__empty" role="status">
          Henuz mesaj yok. Ilk mesaji sen gonder!
        </p>
      );
    }

    return messages.map(message => {
      const hasVipGradient =
        Boolean(message.isVip) && message.gradientStart && message.gradientEnd;
      const gradientStyle = hasVipGradient
        ? {
          backgroundImage: `linear-gradient(${message.gradientAngle ?? 120}deg, ${message.gradientStart}, ${message.gradientEnd})`,
        }
        : undefined;

      return (
        <article
          key={message.id}
          className={`nostalgia-chat-message${hasVipGradient ? ' nostalgia-chat-message--vip' : ''}`}
          style={gradientStyle}
        >
          <header className="nostalgia-chat-message__meta">
            <span className="nostalgia-chat-message__team">{message.teamName}</span>
            <span className="nostalgia-chat-message__manager">{message.username}</span>
            <span className="nostalgia-chat-message__time">{formatTime(message.createdAt)}</span>
          </header>
          <p className="nostalgia-chat-message__text">{message.text}</p>
        </article>
      );
    });
  }, [messages]);

  const widgetPositionStyle = {
    position: 'fixed' as const,
    right: 'max(env(safe-area-inset-right, 0px), clamp(0.45rem, 3vw, 0.9rem))',
    left: 'auto',
    bottom: 'max(env(safe-area-inset-bottom, 0px), clamp(0.45rem, 3vh, 1rem))',
  };

  return (
    <div className="nostalgia-chat-widget !z-[100]" style={widgetPositionStyle} aria-live="polite">
      <button
        type="button"
        className={`nostalgia-chat-button${isOpen ? ' nostalgia-chat-button--active' : ''}`}
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-controls="global-chat-panel"
      >
        <MessageCircle className="nostalgia-chat-button__icon" />
      </button>

      {isOpen ? (
        <div
          id="global-chat-panel"
          className="nostalgia-chat-panel"
          role="dialog"
          aria-label="Oyun ici sohbet penceresi"
        >
          <div className="nostalgia-chat-panel__header">
            <div>
              <h3>Oyuncu Sohbeti</h3>
              <p>Son 1 hafta icindeki mesajlar gosterilir.</p>
            </div>
            <button
              type="button"
              className="nostalgia-chat-panel__close"
              onClick={() => setIsOpen(false)}
              aria-label="Sohbeti kapat"
            >
              <X size={18} />
            </button>
          </div>

          <div
            ref={scrollAreaRef}
            className="nostalgia-chat-panel__body"
            data-state={isLoading ? 'loading' : 'ready'}
          >
            {isLoading ? (
              <div className="nostalgia-chat-panel__loading">
                <Loader2 className="nostalgia-chat-panel__spinner" />
                <span>Mesajlar getiriliyor...</span>
              </div>
            ) : (
              <>
                {renderedMessages}
              </>
            )}
          </div>

          <form className="nostalgia-chat-panel__composer" onSubmit={handleSubmit}>
            <textarea
              name="chat-message"
              placeholder="Mesajini yaz..."
              value={inputValue}
              maxLength={MAX_MESSAGE_LENGTH}
              onChange={event => setInputValue(event.target.value)}
              onKeyDown={handleTextareaKeyDown}
              disabled={isSending}
              rows={2}
            />
            <div className="nostalgia-chat-panel__composer-actions">
              <span className="nostalgia-chat-panel__char-count">{remainingCharacters}</span>
              {vipActive ? (
                <div className="nostalgia-chat-panel__color-pickers">
                  <label className="nostalgia-chat-color-input">
                    <span>Renk 1</span>
                    <input
                      type="color"
                      value={gradientStart}
                      onChange={event => setGradientStart(event.target.value)}
                      aria-label="VIP mesaj rengi 1"
                    />
                  </label>
                  <label className="nostalgia-chat-color-input">
                    <span>Renk 2</span>
                    <input
                      type="color"
                      value={gradientEnd}
                      onChange={event => setGradientEnd(event.target.value)}
                      aria-label="VIP mesaj rengi 2"
                    />
                  </label>
                </div>
              ) : (
                <span className="nostalgia-chat-panel__vip-hint">VIP mesajlari renkli gorunur.</span>
              )}
              <button type="submit" className="nostalgia-chat-panel__send" disabled={isSending || !inputValue.trim()}>
                {isSending ? <Loader2 className="nostalgia-chat-panel__spinner" /> : <Send size={16} />}
                <span>Gonder</span>
              </button>
            </div>
          </form>

          {errorMessage ? <p className="nostalgia-chat-panel__error">{errorMessage}</p> : null}
        </div>
      ) : null}

      <Dialog open={showAdminDialog} onOpenChange={setShowAdminDialog}>
        <DialogContent className="sm:max-w-md bg-[#0a0f16]/95 border border-emerald-900/50 shadow-[0_0_40px_rgba(16,185,129,0.15)] backdrop-blur-xl rounded-2xl text-slate-100 p-6">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-2xl font-bold text-emerald-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
              {t('chatWidget.moderatorActionTitle')}
            </DialogTitle>
            <DialogDescription className="text-slate-300 text-md leading-relaxed mt-3">
              {t('chatWidget.moderatorActionMessage')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-8 flex flex-col gap-4 sm:flex-row sm:justify-end">
            <Button
              variant="secondary"
              className="w-full sm:w-auto bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/50 rounded-xl px-6 py-3 h-auto font-semibold transition-all"
              onClick={() => {
                setShowAdminDialog(false);
                setIsOpen(true);
              }}
            >
              {t('chatWidget.actionChat')}
            </Button>
            <Button
              className="w-full sm:w-auto bg-emerald-600/90 hover:bg-emerald-500 text-white border border-emerald-400/50 rounded-xl px-6 py-3 h-auto font-semibold shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all"
              onClick={() => {
                setShowAdminDialog(false);
                navigate('/admin/chat-moderation');
              }}
            >
              {t('chatWidget.actionModerate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GlobalChatWidget;
