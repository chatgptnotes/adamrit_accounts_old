import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { aiPickTemplate, runTemplate } from "@/components/AskTheBooksCard";
import { FlowScaffold } from "@/tablet/components/FlowScaffold";
import { TabletButton } from "@/tablet/ui/TabletButton";
import { TabletCard } from "@/tablet/ui/TabletCard";

// Two-way voice over the same safe Ask-the-books templates: speech-to-text
// via the browser's recognition engine, the answer read back aloud, then it
// listens again — a conversation, not a form. Nothing leaves the device
// except the text question (to the same AI proxy the typed card uses).

type Turn = { who: "you" | "books"; text: string };

export default function AskBooksVoiceFlow() {
  const [supported, setSupported] = useState(true);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [conversation, setConversation] = useState<Turn[]>([]);
  const recognitionRef = useRef<any>(null);
  const conversationMode = useRef(false);

  useEffect(() => {
    const Recognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript;
      if (text) void handleQuestion(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event: any) => {
      setListening(false);
      if (event.error === "not-allowed") {
        toast.error("Allow microphone access to talk to the books.");
      }
    };
    recognitionRef.current = recognition;
    return () => {
      conversationMode.current = false;
      recognition.abort?.();
      window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const listen = () => {
    if (!recognitionRef.current || listening || speaking) return;
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      /* already started */
    }
  };

  const speak = (text: string) =>
    new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(
        // ₹ symbols read poorly; say "rupees".
        text.replace(/₹/g, " rupees "),
      );
      utterance.lang = "en-IN";
      utterance.rate = 1;
      utterance.onend = () => {
        setSpeaking(false);
        resolve();
      };
      utterance.onerror = () => {
        setSpeaking(false);
        resolve();
      };
      setSpeaking(true);
      synth.speak(utterance);
    });

  const handleQuestion = async (question: string) => {
    setConversation((prev) => [...prev, { who: "you", text: question }]);
    setThinking(true);
    let answer: string;
    try {
      const template = await aiPickTemplate(question);
      answer = template
        ? await runTemplate(template)
        : "I can tell you how much we paid someone, a day's totals, or a ledger's activity. Please ask again.";
    } catch (e) {
      answer = e instanceof Error ? e.message : "I could not answer that.";
    }
    setThinking(false);
    setConversation((prev) => [...prev, { who: "books", text: answer }]);
    await speak(answer);
    // Two-way: after answering, listen for the follow-up.
    if (conversationMode.current) listen();
  };

  const toggleConversation = () => {
    if (listening || conversationMode.current) {
      conversationMode.current = false;
      recognitionRef.current?.abort?.();
      window.speechSynthesis?.cancel();
      setListening(false);
      setSpeaking(false);
    } else {
      conversationMode.current = true;
      listen();
    }
  };

  const active = listening || speaking || thinking || conversationMode.current;

  return (
    <FlowScaffold
      heading="Ask the Books"
      subheading="Talk to the accounts — it answers out loud and keeps listening"
      actions={
        <TabletButton
          className={cn("w-full", active && "bg-red-600 hover:bg-red-700")}
          disabled={!supported}
          onClick={toggleConversation}
        >
          {active ? <MicOff className="mr-2 h-6 w-6" /> : <Mic className="mr-2 h-6 w-6" />}
          {!supported
            ? "Voice not supported in this browser"
            : active
              ? "Stop conversation"
              : "Start conversation"}
        </TabletButton>
      }
    >
      <div className="space-y-3">
        <div
          className={cn(
            "mx-auto flex h-28 w-28 items-center justify-center rounded-full border-4 transition-all",
            listening
              ? "animate-pulse border-red-500 bg-red-50"
              : speaking
                ? "border-blue-500 bg-blue-50"
                : thinking
                  ? "border-amber-500 bg-amber-50"
                  : "border-muted",
          )}
        >
          {speaking ? (
            <Volume2 className="h-10 w-10 text-blue-600" />
          ) : (
            <Mic className={cn("h-10 w-10", listening ? "text-red-600" : "text-muted-foreground")} />
          )}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          {listening
            ? "Listening… ask about payments, a day's totals, or a ledger."
            : speaking
              ? "Speaking the answer…"
              : thinking
                ? "Checking the books…"
                : 'Tap Start and ask, e.g. "how much did we pay Noble this month?"'}
        </p>
        <div className="space-y-2">
          {conversation.slice(-8).map((turn, index) => (
            <TabletCard
              key={index}
              className={cn(
                "p-3 text-sm",
                turn.who === "you" ? "ml-8 bg-primary/5" : "mr-8",
              )}
            >
              <span className="mr-2 text-xs font-semibold uppercase text-muted-foreground">
                {turn.who === "you" ? "You" : "Books"}
              </span>
              {turn.text}
            </TabletCard>
          ))}
        </div>
      </div>
    </FlowScaffold>
  );
}
