import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useInventory } from '@/contexts/InventoryContext';
import { sendGlobalChatMessage, subscribeToGlobalChat } from '@/services/chat';
import type { GlobalChatMessage } from '@/types';

const MAX_MESSAGE_LENGTH = 320;

const formatTime = (value: Date) =>
  value.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });

const GlobalChatWidget: React.FC = () => {
  const { user } = useAuth();
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
      setErrorMessage('Mesaj gonderilemedi. Lutfen tekrar deneyin.');
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
    ? 'Mesajlar en fazla 24 saat boyunca tutulur.'
    : 'Lig menajerleriyle sohbet et.';

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

  return (
    <div className="nostalgia-chat-widget" aria-live="polite">
      <button
        type="button"
        className={`nostalgia-chat-button${isOpen ? ' nostalgia-chat-button--active' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        aria-controls="global-chat-panel"
      >
        <MessageCircle className="nostalgia-chat-button__icon" />
        <span className="nostalgia-chat-button__label">
          {buttonLabel}
          <small>{subtitleText}</small>
        </span>
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
              <p>Son 24 saat icindeki mesajlar gosterilir.</p>
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
              rows={3}
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
    </div>
  );
};

export default GlobalChatWidget;
