/** Labelled form fields for the live run screens, styled like the rest of the dashboard's inputs. */

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function TextField({ label, value, onChange, placeholder, inputMode }: FieldProps & { inputMode?: "decimal" }) {
  return (
    <label className="col g6">
      <span className="cap">{label}</span>
      <span className="input">
        <input
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
      </span>
    </label>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  mono,
  maxLength,
}: FieldProps & { mono?: boolean; maxLength?: number }) {
  return (
    <label className="col g6">
      <span className="cap">{label}</span>
      <textarea
        className={`lr-field${mono ? " code" : ""}`}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        spellCheck={!mono}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      />
    </label>
  );
}
