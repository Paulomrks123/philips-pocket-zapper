import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import appIcon from "@/assets/remote-192.png.asset.json";
import {
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Star, Power, Plus, Minus,
  Undo2, MoreHorizontal, VolumeX, X, Delete, Check, AlertTriangle, Wifi, Menu,
} from "lucide-react";

declare global {
  interface Window {
    PhilipsIR?: {
      getStatus: () => string;
      send: (command: string) => string;
      connectNetwork: (ip: string, mac: string) => string;
    };
  }
}

type IrStatus = { available: boolean; irAvailable?: boolean; profileConfigured: boolean; supports36kHz?: boolean; networkConnected?: boolean; carrierRangesHz?: number[][]; transport?: "infrared" | "wifi" | "waiting"; manufacturer?: string; deviceModel?: string; profile?: string; protocol?: string; message: string };

const LOCAL_BRIDGE = "http://127.0.0.1:8765";

async function callLocalBridge<T>(path: string, body?: Record<string, string>): Promise<T> {
  const response = await fetch(`${LOCAL_BRIDGE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
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

function Round({ children, label, size = "md", tone = "default", onClick }: {
  children: ReactNode; label: string; size?: "md" | "lg"; tone?: "default" | "power" | "star"; onClick: () => void;
}) {
  const s = size === "lg" ? "remote-large" : "remote-medium";
  const t = tone === "power" ? "text-destructive" : tone === "star" ? "text-primary" : "text-foreground/80";
  return (
    <Button variant="remote" size="remote" aria-label={label} onClick={onClick} className={`remote-btn ${s} ${t}`}>
      {children}
    </Button>
  );
}

function Rocker({ label, onUp, onDown, up, down }: { label: string; onUp: () => void; onDown: () => void; up: ReactNode; down: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 text-foreground/90">
      <Button variant="remote" size="remote" aria-label={`${label} +`} onClick={onUp} className="remote-ghost">{up}</Button>
      <span className="h-px w-6 bg-foreground/50" />
      <span className="text-base">{label}</span>
      <span className="h-px w-6 bg-foreground/50" />
      <Button variant="remote" size="remote" aria-label={`${label} -`} onClick={onDown} className="remote-ghost">{down}</Button>
    </div>
  );
}

function Index() {
  const [last, setLast] = useState<string | null>(null);
  const [pad, setPad] = useState(false);
  const [more, setMore] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [layout, setLayout] = useState<"comfortable" | "compact" | "minimal">(() => {
    if (typeof window === "undefined") return "comfortable";
    const saved = window.localStorage.getItem("philips-zapper-layout");
    return saved === "compact" || saved === "minimal" ? saved : "comfortable";
  });
  const [digits, setDigits] = useState("");
  const [irStatus, setIrStatus] = useState<IrStatus | null>(null);
  const [tvIp, setTvIp] = useState(() => typeof window === "undefined" ? "192.168.1.2" : window.localStorage.getItem("philips-zapper-tv-ip") || "192.168.1.2");
  const [tvMac, setTvMac] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("philips-zapper-tv-mac") || "");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem("philips-zapper-layout", layout);
  }, [layout]);

  useEffect(() => {
    window.localStorage.setItem("philips-zapper-tv-ip", tvIp.trim());
  }, [tvIp]);

  useEffect(() => {
    window.localStorage.setItem("philips-zapper-tv-mac", tvMac.trim());
  }, [tvMac]);

  useEffect(() => {
    let active = true;
    let busy = false;
    const reconnect = async () => {
      if (!active || busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const status = window.PhilipsIR
          ? JSON.parse(window.PhilipsIR.getStatus()) as IrStatus
          : await callLocalBridge<IrStatus>("/status");
        if (active) setIrStatus(status);
        if (active && !status.networkConnected) {
          const result = window.PhilipsIR
            ? JSON.parse(window.PhilipsIR.connectNetwork(tvIp, tvMac)) as { ok: boolean; message: string }
            : await callLocalBridge<{ ok: boolean; message: string }>("/connect", { ip: tvIp, mac: tvMac });
          if (active && result.ok) setSyncStatus("Conexão restaurada automaticamente. " + result.message);
        }
      } catch {
        if (active) setIrStatus({
          available: false, profileConfigured: false, networkConnected: false,
          message: "Aguardando a ponte Android e a TV na rede local. A reconexão será tentada automaticamente.",
        });
      } finally { busy = false; }
    };
    void reconnect();
    const timer = window.setInterval(() => { void reconnect(); }, 10000);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [tvIp, tvMac]);

  const syncTv = async () => {
    setSyncStatus("Procurando a TV na rede local...");
    try {
      const response = window.PhilipsIR
        ? JSON.parse(window.PhilipsIR.connectNetwork(tvIp, tvMac)) as { ok: boolean; message: string }
        : await callLocalBridge<{ ok: boolean; message: string }>("/connect", { ip: tvIp, mac: tvMac });
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
    <div
      className={`remote-app layout-${layout} mx-auto flex max-w-md flex-col bg-background`}
      onPointerDownCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("button, [role=\"button\"]")) {
          if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(18);
        }
      }}
    >
      <header className="remote-header bg-[image:var(--gradient-header)] px-4 py-3 text-primary-foreground">
        <div className="flex items-center justify-between gap-2">
          <span className="w-9" />
          <div className="flex items-center justify-center gap-2">
            <img src={appIcon.url} width={32} height={32} alt="" className="size-8 shrink-0 rounded-md" />
            <h1 className="text-lg font-semibold">Philips TV 50PUG6654/78</h1>
          </div>
          <Button variant="ghost" size="icon" aria-label="Abrir menu" onClick={() => setMenuOpen(true)} className="text-primary-foreground"><Menu /></Button>
        </div>
      </header>

      <main className="remote-main relative flex flex-1 flex-col">
        <div className="remote-top grid grid-cols-3 items-start">
          <div><Rocker label="CH" onUp={() => press("CHANNEL_UP")} onDown={() => press("CHANNEL_DOWN")} up={<ChevronUp />} down={<ChevronDown />} /></div>
          <div className="flex justify-center"><Round size="lg" tone="star" label="Favoritos" onClick={() => press("FAVORITES")}><Star className="h-10 w-10 fill-current" /></Round></div>
          <div className="remote-power flex justify-end"><Round tone="power" label="Power" onClick={() => press("POWER")}><Power className="h-8 w-8" /></Round></div>
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
            <Rocker label="VOL" onUp={() => press("VOLUME_UP")} onDown={() => press("VOLUME_DOWN")} up={<Plus />} down={<Minus />} />
            <Button variant="remote" size="remote" aria-label="Mute" onClick={() => press("MUTE")} className="remote-ghost"><VolumeX /></Button>
          </div>
        </div>

        <div className="remote-menu flex justify-center gap-12">
          <Round label="Menu" onClick={() => press("MENU")}><span className="text-lg">Menu</span></Round>
          <Round label="Voltar" onClick={() => press("BACK")}><Undo2 /></Round>
        </div>
        <div className="remote-bottom flex justify-between">
          <Round label="Teclado numérico" onClick={() => setPad(true)}><span className="text-lg">123</span></Round>
          <Round label="Sair" onClick={() => press("EXIT")}><span className="text-lg">Sair</span></Round>
          <Round label="Mais opções" onClick={() => setMore(true)}><MoreHorizontal /></Round>
        </div>

        <p aria-live="polite" className="remote-feedback text-center text-xs text-muted-foreground">
          {last ?? (irStatus?.available ? "Emissor IR detectado" : "Nenhum comando transmitido") }
        </p>
      </main>

      {(menuOpen || pad || more) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70" onClick={() => { setPad(false); setMore(false); setMenuOpen(false); }}>
          <div className="sheet w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <span className="text-lg font-semibold">{menuOpen ? "Aparência do controle" : pad ? (digits || "Canal") : "Funções"}</span>
              <Button variant="remote" size="remote" aria-label="Fechar" onClick={() => { setPad(false); setMore(false); setMenuOpen(false); }} className="remote-ghost"><X /></Button>
            </div>
            {menuOpen ? (
              <div className="grid grid-cols-1 gap-4">
                <section className="space-y-3">
                  <h2 className="text-base font-semibold">Conexão Wi-Fi com a TV</h2>
                  <div className="rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
                    {irStatus ? irStatus.message : "Verificando conexão com a TV..."}
                    <p className="mt-1 text-xs">A conexão e os comandos de rede são feitos pelo aplicativo auxiliar Android. Mantenha-o instalado e ativo.</p>
                  </div>
                  <label className="block space-y-1 text-sm">
                    <span>Endereço IP da TV</span>
                    <input aria-label="Endereço IP da TV" value={tvIp} onChange={(event) => setTvIp(event.target.value)}
                      placeholder="192.168.1.2" inputMode="decimal"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary" />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>MAC da TV (para ligar em standby)</span>
                    <input aria-label="Endereço MAC da TV para ligar em standby" value={tvMac} onChange={(event) => setTvMac(event.target.value)}
                      placeholder="AA:BB:CC:DD:EE:FF"
                      className="w-full rounded-lg border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary" />
                  </label>
                  <Button onClick={syncTv} className="w-full gap-2"><Wifi className="h-4 w-4" /> Sincronizar por Wi-Fi</Button>
                  <p className="text-xs text-muted-foreground">Para ligar a TV em standby pela rede, ela precisa aceitar Wake-on-Wi-Fi/Wake-on-LAN e ter o MAC correto cadastrado. A SAPHI pode não responder enquanto a TV estiver desligada.</p>
                  {syncStatus && <p role="status" className="rounded-lg bg-muted p-2 text-xs">{syncStatus}</p>}
                </section>
                <div className="h-px bg-border" />
                <section className="grid grid-cols-1 gap-3">
                  <h2 className="text-base font-semibold">Tamanho do controle</h2>
                  <p className="text-sm text-muted-foreground">Escolha o tamanho dos botões. Sua preferência fica salva neste aparelho.</p>
                  {[
                    { id: "comfortable", label: "Confortável", detail: "Botões maiores e mais espaço" },
                    { id: "compact", label: "Compacto", detail: "Controles menores" },
                    { id: "minimal", label: "Minimalista", detail: "Interface reduzida" },
                  ].map((option) => (
                    <Button key={option.id} variant={layout === option.id ? "secondary" : "outline"} onClick={() => setLayout(option.id as typeof layout)} className="h-auto justify-between py-3">
                      <span className="flex flex-col items-start"><span>{option.label}</span><span className="text-xs text-muted-foreground">{option.detail}</span></span>
                      {layout === option.id && <Check className="h-4 w-4" />}
                    </Button>
                  ))}
                </section>
              </div>
            ) : pad ? (
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
