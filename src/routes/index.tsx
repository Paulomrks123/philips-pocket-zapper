import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const LAYOUTS = [
  { id: "classic", name: "Clássico" },
  { id: "roxo", name: "Roxo" },
  { id: "verde", name: "Verde" },
  { id: "colorido", name: "Colorido" },
] as const;
type LayoutId = (typeof LAYOUTS)[number]["id"];
import appIcon from "@/assets/remote-192.png.asset.json";
import {
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Star, Power, Plus, Minus,
  Undo2, MoreHorizontal, VolumeX, X, Delete, Check, AlertTriangle, Wifi, Menu as MenuIcon,
} from "lucide-react";

declare global {
  interface Window {
    PhilipsIR?: {
      getStatus: () => string;
      send: (command: string) => string;
      connectNetwork: (ip: string) => string;
    };
  }
}

type IrStatus = { available: boolean; profileConfigured: boolean; supports36kHz?: boolean; networkConnected?: boolean; carrierRangesHz?: number[][]; message: string };

const LOCAL_BRIDGE = "http://127.0.0.1:8765";

async function callLocalBridge<T>(path: string, body?: Record<string, string>): Promise<T> {
  const response = await fetch(`${LOCAL_BRIDGE}${path}`, {
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    mode: "cors",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Ponte local respondeu HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Philips Remote — 50PUG6654/78" },
      { name: "description", content: "Controle remoto para Philips 50PUG6654/78." },
      { property: "og:title", content: "Philips Remote — 50PUG6654/78" },
      { property: "og:description", content: "Controle remoto para Philips 50PUG6654/78." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Round({ children, label, size = "md", role, onClick }: {
  children: ReactNode; label: string; size?: "md" | "lg"; role?: string; onClick: () => void;
}) {
  const s = size === "lg" ? "remote-large" : "remote-medium";
  return (
    <Button variant="remote" size="remote" aria-label={label} onClick={onClick} className={`remote-btn ${s} ${role ? `role-btn role-${role}` : "text-foreground/80"}`}>
      {children}
    </Button>
  );
}

function Rocker({ label, tone, onUp, onDown, up, down }: { label: string; tone: "ch" | "vol"; onUp: () => void; onDown: () => void; up: ReactNode; down: ReactNode }) {
  return (
    <div className={`rocker rocker-${tone}`}>
      <Button variant="remote" size="remote" aria-label={`${label} +`} onClick={onUp} className="remote-ghost rocker-up">{up}</Button>
      <span className="text-base font-semibold">{label}</span>
      <Button variant="remote" size="remote" aria-label={`${label} -`} onClick={onDown} className="remote-ghost rocker-down">{down}</Button>
    </div>
  );
}

function Index() {
  const [last, setLast] = useState<string | null>(null);
  const [pad, setPad] = useState(false);
  const [more, setMore] = useState(false);
  const [digits, setDigits] = useState("");
  const [irStatus, setIrStatus] = useState<IrStatus | null>(null);
  const [tvIp, setTvIp] = useState("192.168.1.2");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutId>("classic");

  useEffect(() => {
    const saved = localStorage.getItem("remote-layout");
    if (saved && LAYOUTS.some((l) => l.id === saved)) setLayout(saved as LayoutId);
  }, []);
  const chooseLayout = (id: LayoutId) => { setLayout(id); localStorage.setItem("remote-layout", id); };

  useEffect(() => {
    let active = true;
    const readStatus = async () => {
      try {
        const status = window.PhilipsIR
          ? JSON.parse(window.PhilipsIR.getStatus()) as IrStatus
          : await callLocalBridge<IrStatus>("/status");
        if (active) setIrStatus(status);
      } catch {
        if (active) setIrStatus({
          available: false,
          profileConfigured: false,
          networkConnected: false,
          message: "Abra o Philips Pocket Zapper auxiliar no Android para ativar a ponte local do PWA.",
        });
      }
    };
    void readStatus();
    return () => { active = false; };
  }, []);

  const syncTv = async () => {
    setSyncStatus("Procurando a TV na rede local...");
    try {
      const response = window.PhilipsIR
        ? JSON.parse(window.PhilipsIR.connectNetwork(tvIp)) as { ok: boolean; message: string }
        : await callLocalBridge<{ ok: boolean; message: string }>("/connect", { ip: tvIp });
      setSyncStatus(response.message);
      if (response.ok) {
        setIrStatus((previous) => ({
          available: previous?.available ?? false,
          profileConfigured: previous?.profileConfigured ?? false,
          networkConnected: true,
          message: "TV encontrada pela ponte local.",
        }));
      }
    } catch {
      setSyncStatus("Ponte local indisponível. Abra o aplicativo auxiliar Philips Pocket Zapper no Android, mantenha-o em segundo plano e tente novamente. Se o Chrome pedir acesso à rede local, permita.");
    }
  };

  const press = async (c: string) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(15);
    try {
      const response = window.PhilipsIR
        ? JSON.parse(window.PhilipsIR.send(c)) as { ok: boolean; message: string }
        : await callLocalBridge<{ ok: boolean; message: string }>("/send", { command: c });
      setLast(`${c}: ${response.message}`);
    } catch {
      setLast(`${c}: ponte local indisponível. Abra o aplicativo auxiliar Android e mantenha-o em segundo plano.`);
    }
  };

  return (
    <div data-layout={layout} className="remote-app mx-auto flex max-w-md flex-col bg-background">
      <header className="remote-header flex items-center gap-2 bg-[image:var(--gradient-header)] px-3 pb-2 text-primary-foreground">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="remote" size="remote" aria-label="Abrir menu" className="remote-ghost"><MenuIcon /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[85vw] max-w-sm overflow-y-auto">
            <SheetHeader><SheetTitle>Configurações</SheetTitle></SheetHeader>
            <div className="mt-4 flex flex-col gap-5 px-4 pb-6">
              <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {irStatus ? irStatus.message : "Modo web: sem acesso direto ao infravermelho"}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Conectar à TV</span>
                <input aria-label="Endereço IP da TV" value={tvIp} onChange={(e) => setTvIp(e.target.value)} placeholder="IP da TV (192.168.1.2)" inputMode="decimal"
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <Button onClick={syncTv} className="gap-2"><Wifi className="h-4 w-4" /> Sincronizar</Button>
                {syncStatus && <p role="status" className="text-xs text-muted-foreground">{syncStatus}</p>}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Layout</span>
                <div className="grid grid-cols-2 gap-2">
                  {LAYOUTS.map((l) => (
                    <button key={l.id} type="button" onClick={() => chooseLayout(l.id)} aria-pressed={layout === l.id}
                      className={`layout-swatch rounded-lg border-2 p-2 text-left text-sm ${layout === l.id ? "border-primary" : "border-transparent"}`} data-layout={l.id}>
                      <span className="swatch-bar mb-2 flex h-8 items-center justify-center rounded-md"><span className="swatch-dot block size-5 rounded-full" /></span>{l.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
        <img src={appIcon.url} width={24} height={24} alt="" className="size-6 shrink-0 rounded-md" />
        <h1 className="truncate text-base font-semibold">Philips TV 50PUG6654/78</h1>
      </header>

      <main className="remote-main relative flex flex-1 flex-col">
        <div className="remote-top grid grid-cols-3 items-start">
          <div><Rocker label="CH" tone="ch" onUp={() => press("CHANNEL_UP")} onDown={() => press("CHANNEL_DOWN")} up={<ChevronUp />} down={<ChevronDown />} /></div>
          <div className="flex justify-center"><Round size="lg" role="star" label="Favoritos" onClick={() => press("FAVORITES")}><Star className="h-10 w-10 fill-current" /></Round></div>
          <div className="remote-power flex justify-end"><Round role="power" label="Power" onClick={() => press("POWER")}><Power className="h-8 w-8" /></Round></div>
        </div>

        <div className="remote-navigation grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <div className="dpad mx-auto">
            {([
              ["UP", "top-0 left-1/2 -translate-x-1/2", <ChevronUp key="u" />],
              ["DOWN", "bottom-0 left-1/2 -translate-x-1/2", <ChevronDown key="d" />],
              ["LEFT", "left-0 top-1/2 -translate-y-1/2", <ChevronLeft key="l" />],
              ["RIGHT", "right-0 top-1/2 -translate-y-1/2", <ChevronRight key="r" />],
            ] as const).map(([c, pos, icon]) => (
              <Button variant="remote" size="remote" key={c} aria-label={c} onClick={() => press(c)} className={`dpad-dir absolute ${pos}`}>{icon}</Button>
            ))}
            <Button variant="remote" size="remote" aria-label="OK" onClick={() => press("OK")} className="dpad-ok">OK</Button>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Rocker label="VOL" tone="vol" onUp={() => press("VOLUME_UP")} onDown={() => press("VOLUME_DOWN")} up={<Plus />} down={<Minus />} />
            <Button variant="remote" size="remote" aria-label="Mute" onClick={() => press("MUTE")} className="remote-ghost"><VolumeX /></Button>
          </div>
        </div>

        <div className="remote-menu flex justify-center gap-12">
          <Round role="menu" label="Menu" onClick={() => press("MENU")}><span className="text-lg">Menu</span></Round>
          <Round role="back" label="Voltar" onClick={() => press("BACK")}><Undo2 /></Round>
        </div>
        <div className="remote-bottom flex justify-between">
          <Round role="k123" label="Teclado numérico" onClick={() => setPad(true)}><span className="text-lg">123</span></Round>
          <Round role="exit" label="Sair" onClick={() => press("EXIT")}><span className="text-lg">Sair</span></Round>
          <Round role="more" label="Mais opções" onClick={() => setMore(true)}><MoreHorizontal /></Round>
        </div>

        <p aria-live="polite" className="remote-feedback text-center text-xs text-muted-foreground">
          {last ?? (irStatus?.available ? "Emissor IR detectado" : "Nenhum comando transmitido") }
        </p>
      </main>

      {(pad || more) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70" onClick={() => { setPad(false); setMore(false); }}>
          <div className="sheet w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-semibold">{pad ? (digits || "Canal") : "Funções"}</span>
              <Button variant="remote" size="remote" aria-label="Fechar" onClick={() => { setPad(false); setMore(false); }} className="remote-ghost"><X /></Button>
            </div>
            {pad ? (
              <div className="grid grid-cols-3 gap-3">
                {["1","2","3","4","5","6","7","8","9"].map((d) => (
                  <Button variant="remote" size="remote" key={d} onClick={() => { setDigits((v) => (v + d).slice(0, 3)); press(`NUM_${d}`); }} className="key">{d}</Button>
                ))}
                <Button variant="remote" size="remote" aria-label="Apagar" onClick={() => setDigits((v) => v.slice(0, -1))} className="key"><Delete /></Button>
                <Button variant="remote" size="remote" onClick={() => { setDigits((v) => (v + "0").slice(0, 3)); press("NUM_0"); }} className="key">0</Button>
                <Button variant="remote" size="remote" aria-label="Confirmar" onClick={() => { press(`OK (${digits})`); setDigits(""); setPad(false); }} className="key text-primary"><Check /></Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {["SOURCE","TV","AV","HDMI","INFO","GUIDE","IMAGEM","SOM","SLEEP"].map((c) => (
                  <Button variant="remote" size="remote" key={c} onClick={() => press(c)} className="key text-sm">{c}</Button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
