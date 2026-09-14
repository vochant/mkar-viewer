import { useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, LockKeyhole, Plus, Trash2, X } from "lucide-react";
import { useI18n } from "./i18n";
import type { TarVariant } from "./mkarCodec";

export type PackingKey = { index: number; password: string };
export type PackingAssignment = { path: string; keyIndex: number | null };
export type CompressionAssignment = { path: string; enabled: boolean };
export type EntryEncryptionSetting = "inherit" | "off" | "key";
export type EntryCompressionSetting = "inherit" | "on" | "off";

function DialogShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="dialog-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function ConfirmDialog({
  message,
  onCancel,
  onConfirm,
}: {
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell title={t("unsaved")} onClose={onCancel}>
      <div className="dialog-body">
        <p>{message}</p>
      </div>
      <footer className="dialog-actions">
        <button className="button button-secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button className="button button-danger-solid" onClick={onConfirm}>
          {t("discard")}
        </button>
      </footer>
    </DialogShell>
  );
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [upstreamBefore, upstreamAfter] = t("aboutUpstream").split("{project}");
  return (
    <DialogShell title={t("about")} onClose={onClose}>
      <div className="dialog-body about-body">
        <p className="about-copyright">{t("copyright")}</p>
        <p>{t("aboutProcessing")}</p>
        <p>
          {upstreamBefore}
          <a className="about-link" href="https://github.com/vochant/remkar" target="_blank" rel="noreferrer">
            vochant/remkar
          </a>
          {upstreamAfter}
        </p>
      </div>
      <footer className="dialog-actions">
        <button className="button button-primary" onClick={onClose}>
          {t("aboutClose")}
        </button>
      </footer>
    </DialogShell>
  );
}

export function PasswordDialog({
  keyIndex,
  incorrect,
  onCancel,
  onSubmit,
}: {
  keyIndex: number;
  incorrect: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password) onSubmit(password);
  };
  return (
    <DialogShell title={t("unlockKey", { index: keyIndex })} onClose={onCancel}>
      <form onSubmit={submit}>
        <div className="dialog-body">
          <div className="dialog-symbol">
            <LockKeyhole size={20} />
          </div>
          <p>{t("encryptedPart", { index: keyIndex })}</p>
          <label className="field-label">
            {t("password")}
            <input
              autoFocus
              className="text-field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={incorrect}
            />
          </label>
          {incorrect && <p className="field-error">{t("incorrectPassword")}</p>}
        </div>
        <footer className="dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={!password}
          >
            {t("unlock")}
          </button>
        </footer>
      </form>
    </DialogShell>
  );
}

export function EncryptionDialog({
  initialKeys,
  initialEnabled,
  initialDefaultKeyIndex,
  initialEncryptDirectories,
  initialCompress,
  initialTarVariant,
  onCancel,
  onSave,
}: {
  initialKeys: PackingKey[];
  initialEnabled: boolean;
  initialDefaultKeyIndex: number | null;
  initialEncryptDirectories: boolean;
  initialCompress: boolean;
  initialTarVariant: TarVariant;
  onCancel: () => void;
  onSave: (
    keys: PackingKey[],
    enabled: boolean,
    defaultKeyIndex: number | null,
    encryptDirectories: boolean,
    compress: boolean,
    tarVariant: TarVariant,
  ) => void;
}) {
  const { t } = useI18n();
  const [keys, setKeys] = useState(initialKeys);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [defaultKeyIndex, setDefaultKeyIndex] = useState<number | null>(
    initialDefaultKeyIndex,
  );
  const [encryptDirectories, setEncryptDirectories] = useState(
    initialEncryptDirectories,
  );
  const [compress, setCompress] = useState(initialCompress);
  const [tarVariant, setTarVariant] = useState(initialTarVariant);
  const [indexText, setIndexText] = useState("0");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [selectedKey, setSelectedKey] = useState(
    String(initialKeys[0]?.index ?? 0),
  );
  const [error, setError] = useState("");

  const addKey = () => {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0 || index > 0xffff_ffff) {
      setError(t("keyIndexError"));
      return;
    }
    if (!password) {
      setError(t("packingPasswordRequired"));
      return;
    }
    if (password !== confirmation) {
      setError(t("passwordsDoNotMatch"));
      return;
    }
    setKeys((current) =>
      [
        ...current.filter((key) => key.index !== index),
        { index, password },
      ].sort((left, right) => left.index - right.index),
    );
    setSelectedKey(String(index));
    setPassword("");
    setConfirmation("");
    setError("");
  };

  const removeKey = (index: number) => {
    const next = keys.filter((key) => key.index !== index);
    setKeys(next);
    if (defaultKeyIndex === index) setDefaultKeyIndex(null);
    if (selectedKey === String(index))
      setSelectedKey(String(next[0]?.index ?? 0));
  };

  return (
    <DialogShell title={t("settings")} onClose={onCancel}>
      <div className="dialog-body encryption-dialog-body">
        <section className="dialog-section">
          <h3>{t("packingKeys")}</h3>
          <div className="key-entry-grid">
            <label className="field-label">
              {t("keyIndex")}
              <input
                className="text-field"
                inputMode="numeric"
                value={indexText}
                onChange={(event) => setIndexText(event.target.value)}
              />
            </label>
            <label className="field-label">
              {t("password")}
              <input
                className="text-field"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field-label">
              {t("confirm")}
              <input
                className="text-field"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <button
              className="button button-secondary add-key"
              onClick={addKey}
            >
              <Plus size={16} /> {t("addShort")}
            </button>
          </div>
          <div className="key-list" aria-label={t("packingKeys")}>
            {keys.length ? (
              keys.map((key) => (
                <div className="key-row" key={key.index}>
                  <KeyRound size={16} />
                  <span>{t("keyLabel", { index: key.index })}</span>
                  <button
                    className="icon-button"
                    aria-label={t("removeKey", { index: key.index })}
                    onClick={() => removeKey(key.index)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            ) : (
              <p className="empty-inline">{t("noPackingKeys")}</p>
            )}
          </div>
        </section>

        <section className="dialog-section">
          <h3>{t("globalDefaults")}</h3>
          <div className="global-policy-row">
            <label className="checkbox-field">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              {t("enableEncryption")}
            </label>
            <label className="checkbox-field">
              <input type="checkbox" checked={compress} onChange={(event) => setCompress(event.target.checked)} />
              {t("compressPayloads")}
            </label>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={encryptDirectories} onChange={(event) => setEncryptDirectories(event.target.checked)} />
            {t("encryptDirectories")}
          </label>
          <label className="field-label default-key-field">
            {t("defaultPackingKey")}
            <select className="text-field" aria-label={t("defaultPackingKeyLabel")} value={defaultKeyIndex ?? ""} onChange={(event) => setDefaultKeyIndex(event.target.value ? Number(event.target.value) : null)} disabled={!keys.length || !enabled}>
              <option value="">{t("noDefaultKey")}</option>
              {keys.map((key) => <option value={key.index} key={key.index}>{t("keyLabel", { index: key.index })}</option>)}
            </select>
          </label>
        </section>

        <section className="dialog-section">
          <h3>{t("exportSettings")}</h3>
          <label className="field-label">
            {t("tarVariant")}
            <select
              className="text-field"
              value={tarVariant}
              onChange={(event) =>
                setTarVariant(event.target.value as TarVariant)
              }
            >
              <option value="gnu">GNU</option>
              <option value="pax">PAX</option>
              <option value="ustar">POSIX ustar</option>
              <option value="v7">V7</option>
            </select>
          </label>
        </section>
        {error && <p className="field-error">{error}</p>}
      </div>
      <footer className="dialog-actions">
        <button className="button button-secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          className="button button-primary"
          onClick={() =>
            onSave(
              keys,
              enabled,
              defaultKeyIndex,
              encryptDirectories,
              compress,
              tarVariant,
            )
          }
        >
          {t("save")}
        </button>
      </footer>
    </DialogShell>
  );
}

export function EntrySettingsDialog({
  entryName,
  encryption,
  compression,
  initialKeyIndex,
  keys,
  onCancel,
  onSave,
}: {
  entryName: string;
  encryption: EntryEncryptionSetting;
  compression: EntryCompressionSetting;
  initialKeyIndex: number | null;
  keys: PackingKey[];
  onCancel: () => void;
  onSave: (
    encryption: EntryEncryptionSetting,
    keyIndex: number | null,
    compression: EntryCompressionSetting,
  ) => void;
}) {
  const { t } = useI18n();
  const [encryptionValue, setEncryptionValue] = useState(encryption);
  const [keyIndex, setKeyIndex] = useState<number | null>(initialKeyIndex);
  const [compressionValue, setCompressionValue] = useState(compression);
  return (
    <DialogShell
      title={t("settingsFor", { name: entryName })}
      onClose={onCancel}
    >
      <div className="dialog-body">
        <label className="field-label">
          {t("encryption")}
          <select
            className="text-field"
            aria-label={t("encryptionSettingFor", { name: entryName })}
            value={encryptionValue}
            onChange={(event) => {
              const value = event.target.value as EntryEncryptionSetting;
              setEncryptionValue(value);
              if (value === "key" && keyIndex === null)
                setKeyIndex(keys[0]?.index ?? null);
            }}
          >
            <option value="inherit">{t("unset")}</option>
            <option value="off">{t("off")}</option>
            <option value="key">{t("useKey")}</option>
          </select>
        </label>
        <label className="field-label">
          {t("packingKey")}
          <select
            className="text-field"
            aria-label={t("packingKeyFor", { name: entryName })}
            value={keyIndex ?? ""}
            onChange={(event) => setKeyIndex(Number(event.target.value))}
            disabled={encryptionValue !== "key" || !keys.length}
          >
            {!keys.length && <option value="">{t("noKeys")}</option>}
            {keys.length > 0 && <option value="">{t("selectKey")}</option>}
            {keys.map((key) => (
              <option value={key.index} key={key.index}>
                {t("keyLabel", { index: key.index })}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          {t("compression")}
          <select
            className="text-field"
            aria-label={t("compressionSettingFor", { name: entryName })}
            value={compressionValue}
            onChange={(event) =>
              setCompressionValue(event.target.value as EntryCompressionSetting)
            }
          >
            <option value="inherit">{t("unset")}</option>
            <option value="on">{t("on")}</option>
            <option value="off">{t("off")}</option>
          </select>
        </label>
      </div>
      <footer className="dialog-actions">
        <button className="button button-secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
        <button
          className="button button-primary"
          onClick={() =>
            onSave(
              encryptionValue,
              encryptionValue === "key"
                ? keyIndex
                : encryptionValue === "off"
                  ? null
                  : null,
              compressionValue,
            )
          }
          disabled={encryptionValue === "key" && keyIndex === null}
        >
          {t("save")}
        </button>
      </footer>
    </DialogShell>
  );
}
