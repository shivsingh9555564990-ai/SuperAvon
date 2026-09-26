import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  Trash2,
  Copy,
  Check,
  ChevronDown,
  RefreshCw,
  Cpu,
  History,
  Zap,
  Image as ImageIcon,
  X,
  Maximize2,
  Minimize2,
  Upload,
} from 'lucide-react';
import { FormattedAiResponse, cleanAiSymbols } from './FormattedAiResponse';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string; // data URL or base64 preview
  model?: string;
  timestamp: string;
}

interface ServerModel {
  id: string;
  name?: string;
  description?: string;
  owned_by?: string;
}

export default function App() {
  const [models, setModels] = useState<ServerModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.7-flash');
  const [isLoadingModels, setIsLoadingModels] = useState<boolean>(true);
  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);
  const [useMemory, setUseMemory] = useState<boolean>(true);
  const [isMaximized, setIsMaximized] = useState<boolean>(true); // UI MAX by default!

  // Image Upload State
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [attachedImageName, setAttachedImageName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Namaste! Gemini Multimodal Vision AI active hai. Aap text ke sath-sath image upload karke pooch sakte hain (jaise: photo analysis, math problem, object identification, handwriting reading). Screen maximize mode me set hai.',
      model: 'gemini-3.7-flash',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch models directly from Python script server via /v1/models
  const fetchModels = async () => {
    setIsLoadingModels(true);
    try {
      const res = await fetch('/v1/models');
      const data = await res.json();
      if (data && Array.isArray(data.data) && data.data.length > 0) {
        setModels(data.data);
        setIsOnline(true);
        if (!data.data.some((m: ServerModel) => m.id === selectedModel)) {
          setSelectedModel(data.data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch models from script server:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  // Image Selection Handler with compression for maximum speed & reliability
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAttachedImageName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Resize large images if width/height > 1200 to keep transfer ultra fast
        const maxDim = 1200;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
          setAttachedImage(dataUrl);
        } else {
          setAttachedImage(event.target?.result as string);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);

    // Reset input so user can choose same file again if needed
    e.target.value = '';
  };

  const removeAttachedImage = () => {
    setAttachedImage(null);
    setAttachedImageName('');
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!input.trim() && !attachedImage) || isLoading) return;

    const userText = input.trim();
    const currentImg = attachedImage;

    setInput('');
    removeAttachedImage();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userText || (currentImg ? 'Analyze this image.' : ''),
      image: currentImg || undefined,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setIsLoading(true);

    const assistantId = `assistant-${Date.now()}`;
    const assistantTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    try {
      // Build OpenAI-compliant multi-modal payloads
      let historyToSend: any[] = [];
      if (useMemory) {
        historyToSend = newMessages
          .filter((m) => m.id !== 'welcome' && m.id !== 'welcome-reset' && !m.content.startsWith('⚠️'))
          .map((m) => {
            if (m.role === 'user' && m.image) {
              return {
                role: 'user',
                content: [
                  { type: 'text', text: m.content },
                  { type: 'image_url', image_url: { url: m.image } },
                ],
              };
            }
            return {
              role: m.role,
              content: m.content,
            };
          });
      } else {
        if (currentImg) {
          historyToSend = [
            {
              role: 'user',
              content: [
                { type: 'text', text: userText || 'Describe and analyze this image in full detail.' },
                { type: 'image_url', image_url: { url: currentImg } },
              ],
            },
          ];
        } else {
          historyToSend = [{ role: 'user', content: userText }];
        }
      }

      // Real-time SSE streaming directly to Python script
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          stream: true,
          messages: historyToSend,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(errorText || `HTTP ${res.status}`);
      }

      setIsOnline(true);

      // Create placeholder assistant message for live typing
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: 'assistant',
          content: '',
          model: selectedModel,
          timestamp: assistantTime,
        },
      ]);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              const jsonStr = trimmed.slice(6);
              try {
                const parsed = JSON.parse(jsonStr);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                if (delta) {
                  fullText += delta;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantId ? { ...msg, content: fullText } : msg
                    )
                  );
                }
              } catch {
                // Ignore chunk parse error
              }
            }
          }
        }
      }

      if (!fullText) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? { ...msg, content: 'Analysis completed, but response was empty.' }
              : msg
          )
        );
      }
    } catch (err: any) {
      setIsOnline(false);
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === assistantId);
        if (exists) {
          return prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ Error: ${err.message || 'Network issue'}. Please try again.` }
              : m
          );
        }
        return [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ Script connection error: ${err.message || 'Network issue'}. Please try again.`,
            timestamp: assistantTime,
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleClearChat = () => {
    if (window.confirm('Chat history aur memory clear karni hai?')) {
      setMessages([
        {
          id: 'welcome-reset',
          role: 'assistant',
          content: 'Chat reset ho gayi hai. Naya sawal ya image bhejein!',
          model: selectedModel,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  };

  const currentModelObj = models.find((m) => m.id === selectedModel);

  return (
    <div className="flex justify-center w-full min-h-screen bg-neutral-950 font-sans text-neutral-100 select-none">
      {/* UI Maximize / Responsive Container */}
      <div
        className={`h-screen flex flex-col bg-neutral-900 border-neutral-800 shadow-2xl relative overflow-hidden transition-all duration-300 ${
          isMaximized
            ? 'w-full max-w-4xl border-x' // UI MAX Wide Layout
            : 'w-full max-w-md border-x' // Android Phone Compact Layout
        }`}
      >
        {/* Top App Bar */}
        <header className="px-4 py-3 bg-neutral-900/90 backdrop-blur-md border-b border-neutral-800/80 flex items-center justify-between z-30 sticky top-0">
          <div className="flex items-center space-x-3 min-w-0 flex-1">
            <div className="relative shrink-0">
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-indigo-600 via-blue-500 to-cyan-400 p-[2px] flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <div className="w-full h-full bg-neutral-900 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-cyan-400 animate-pulse" />
                </div>
              </div>
              <span
                className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-neutral-900 ${
                  isOnline ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-sm tracking-tight text-white truncate">Gemini Web2API</h1>
                <span className="text-[10px] bg-gradient-to-r from-blue-500/20 to-indigo-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.2 rounded font-mono font-medium">
                  Vision + Chat
                </span>
                <span className="hidden sm:inline-block text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.2 rounded font-mono">
                  {models.length} Models
                </span>
              </div>

              {/* Dynamic Model Dropdown Trigger */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowModelMenu(!showModelMenu)}
                  className="flex items-center space-x-1.5 text-xs text-neutral-300 hover:text-white transition-colors mt-0.5 max-w-full"
                >
                  <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate font-semibold text-xs text-cyan-300">
                    {currentModelObj?.id || selectedModel}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                </button>

                {/* Model Selector Sheet / Menu */}
                {showModelMenu && (
                  <div className="absolute left-0 mt-2 w-80 max-h-96 overflow-y-auto bg-neutral-800/95 backdrop-blur-xl border border-neutral-700/90 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-700/60 mb-1.5">
                      <span className="text-[11px] font-semibold text-neutral-300 uppercase tracking-wider">
                        Server Models ({models.length})
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchModels();
                        }}
                        title="Reload models from server"
                        className="text-neutral-400 hover:text-white p-1 rounded-full hover:bg-neutral-700"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
                      </button>
                    </div>

                    {models.length === 0 ? (
                      <div className="p-3 text-center text-xs text-neutral-400">Loading models...</div>
                    ) : (
                      models.map((model) => {
                        const isSelected = selectedModel === model.id;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              setSelectedModel(model.id);
                              setShowModelMenu(false);
                            }}
                            className={`w-full text-left px-3 py-2 rounded-xl text-xs transition-all my-0.5 ${
                              isSelected
                                ? 'bg-indigo-600 text-white font-medium shadow-sm'
                                : 'text-neutral-300 hover:bg-neutral-700/70'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-xs font-semibold">{model.id}</span>
                              {isSelected && <Check className="w-4 h-4 text-white" />}
                            </div>
                            {model.description && (
                              <div
                                className={`text-[10px] mt-0.5 line-clamp-1 ${
                                  isSelected ? 'text-indigo-200' : 'text-neutral-400'
                                }`}
                              >
                                {model.description}
                              </div>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons (Maximize/Minimize, Memory Toggle, Clear Chat) */}
          <div className="flex items-center space-x-1.5 shrink-0">
            {/* Memory Toggle Button */}
            <button
              type="button"
              onClick={() => setUseMemory(!useMemory)}
              title={useMemory ? 'Memory Active (Full Chat Context)' : 'Memory Off (Single Turn)'}
              className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                useMemory
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{useMemory ? 'Memory Active' : 'Memory Off'}</span>
              <span className="sm:hidden">{useMemory ? 'Mem' : 'Off'}</span>
            </button>

            {/* UI Maximize / Minimize Switch */}
            <button
              type="button"
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? 'Switch to Mobile Width' : 'Maximize UI (Wide Screen)'}
              className="p-2 text-neutral-400 hover:text-white active:scale-95 transition-all rounded-full hover:bg-neutral-800 border border-neutral-750"
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>

            {/* Clear Chat */}
            <button
              type="button"
              onClick={handleClearChat}
              title="Clear Chat History"
              className="p-2 text-neutral-400 hover:text-rose-400 active:scale-95 transition-all rounded-full hover:bg-neutral-800"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Chat Messages Body */}
        <main className="flex-1 overflow-y-auto px-4 py-5 space-y-5 select-text">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} group transition-all duration-200 animate-in fade-in slide-in-from-bottom-2`}
              >
                <div
                  className={`max-w-[90%] sm:max-w-[80%] rounded-3xl px-4 py-3.5 text-sm leading-relaxed shadow-md relative ${
                    isUser
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-sm shadow-indigo-600/10'
                      : 'bg-neutral-800/95 text-neutral-100 border border-neutral-700/60 rounded-tl-sm shadow-black/25'
                  }`}
                >
                  {/* Assistant header tag */}
                  {!isUser && (
                    <div className="flex items-center space-x-1.5 mb-2 pb-1.5 border-b border-neutral-700/50">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="text-[11px] font-mono text-cyan-300 font-semibold truncate">
                        {msg.model || selectedModel}
                      </span>
                    </div>
                  )}

                  {/* Attached Image Preview in Chat Bubble */}
                  {msg.image && (
                    <div className="mb-2.5 rounded-2xl overflow-hidden border border-white/10 bg-black/40 shadow-sm max-w-sm">
                      <img
                        src={msg.image}
                        alt="Uploaded preview"
                        className="w-full max-h-72 object-contain bg-neutral-950/80"
                      />
                    </div>
                  )}

                  {/* Message Content */}
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words min-h-[1.2rem] text-[13.5px] sm:text-sm">
                      {msg.content}
                    </div>
                  ) : msg.content ? (
                    <FormattedAiResponse content={msg.content} />
                  ) : (
                    <span className="inline-flex items-center space-x-1.5 text-neutral-400 text-xs italic py-1">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
                      <span>Analyzing with Gemini...</span>
                    </span>
                  )}

                  {/* Footer & Copy */}
                  <div
                    className={`flex items-center justify-between mt-2.5 pt-1.5 text-[10px] space-x-2 ${
                      isUser ? 'text-blue-200' : 'text-neutral-500'
                    }`}
                  >
                    <span>{msg.timestamp}</span>
                    {!isUser && msg.content && (
                      <button
                        type="button"
                        onClick={() => handleCopy(cleanAiSymbols(msg.content), msg.id)}
                        className="hover:text-white transition-colors p-1 rounded-md hover:bg-neutral-700/50 flex items-center space-x-1"
                        title="Copy clean message"
                      >
                        {copiedId === msg.id ? (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing/Thinking indicator (only before first token arrives) */}
          {isLoading && !messages.some((m) => m.role === 'assistant' && m.content === '') && (
            <div className="flex items-start animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-neutral-800/95 border border-neutral-700/60 rounded-3xl rounded-tl-sm px-4 py-3 shadow-md flex items-center space-x-2.5">
                <div className="flex space-x-1.5 items-center">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-neutral-300 ml-1">
                  Gemini Vision analysis shuru ho raha hai...
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </main>

        {/* Bottom Input Area with Image Attachment Preview */}
        <footer className="p-3 sm:p-4 bg-neutral-900/95 backdrop-blur-lg border-t border-neutral-800/80 sticky bottom-0 z-20">
          
          {/* Attached Image Preview bar before sending */}
          {attachedImage && (
            <div className="mb-2.5 flex items-center justify-between bg-neutral-800/90 border border-indigo-500/50 rounded-2xl p-2 animate-in fade-in slide-in-from-bottom-2">
              <div className="flex items-center space-x-3 overflow-hidden">
                <img
                  src={attachedImage}
                  alt="Attachment preview"
                  className="w-12 h-12 rounded-xl object-cover border border-neutral-700 bg-black shrink-0"
                />
                <div className="truncate">
                  <div className="text-xs font-medium text-white truncate max-w-[200px] sm:max-w-md">
                    {attachedImageName || 'Selected Image'}
                  </div>
                  <div className="text-[10px] text-cyan-400 flex items-center space-x-1 mt-0.5">
                    <Sparkles className="w-2.5 h-2.5" />
                    <span>Ready for AI Analysis</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={removeAttachedImage}
                className="p-1.5 text-neutral-400 hover:text-rose-400 hover:bg-neutral-700/60 rounded-full transition-colors"
                title="Remove image"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <form
            onSubmit={handleSend}
            className="flex items-end space-x-2 bg-neutral-800/90 border border-neutral-700/70 focus-within:border-indigo-500 rounded-3xl p-1.5 sm:px-3 sm:py-2 transition-all shadow-inner"
          >
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              className="hidden"
            />

            {/* Image Upload Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach image for AI analysis"
              className={`p-2.5 rounded-full transition-all shrink-0 ${
                attachedImage
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-700/60'
              }`}
            >
              <ImageIcon className="w-5 h-5" />
            </button>

            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={
                attachedImage
                  ? 'Ask anything about this image (e.g., explain, solve, describe)...'
                  : `Message (${selectedModel}) or attach an image...`
              }
              className="flex-1 bg-transparent text-sm text-neutral-100 placeholder-neutral-500 outline-none resize-none py-1.5 max-h-[140px] leading-relaxed"
            />

            <button
              type="submit"
              disabled={(!input.trim() && !attachedImage) || isLoading}
              className={`p-2.5 rounded-full transition-all flex items-center justify-center shrink-0 ${
                (input.trim() || attachedImage) && !isLoading
                  ? 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-600/30 active:scale-90 hover:brightness-110'
                  : 'bg-neutral-700/60 text-neutral-500 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </form>
          
          <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-neutral-500">
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center text-cyan-400">
                <Zap className="w-2.5 h-2.5 mr-0.5" />
                Live Stream Active
              </span>
              <span>•</span>
              <span className={useMemory ? 'text-emerald-400 font-medium' : 'text-neutral-500'}>
                {useMemory ? 'Memory On' : 'Memory Off'}
              </span>
            </div>
            <div className="flex items-center space-x-1.5">
              <Upload className="w-3 h-3 text-indigo-400" />
              <span className="text-neutral-400">Multimodal Scotty Active</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
