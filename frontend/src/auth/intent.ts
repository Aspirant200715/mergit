/** `login` refuses anything nobody has registered; `register` creates the account on first use. */
export type Intent = "login" | "register";

/** The server found nothing to sign in to: the person has to create an account first. */
export class NoAccountError extends Error {
  constructor() {
    super("No Mergit account uses that sign-in yet. Create an account to get started.");
    this.name = "NoAccountError";
  }
}
