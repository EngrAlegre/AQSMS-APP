// Test IDs for the auth feature (login, register, logout) — consumed via
// React Native's `testID` prop on TouchableOpacity / Pressable / TextInput /
// Button / Switch and friends. Add new keys here as you wire up additional
// auth UI; see ./index.js for the recipe to add a new feature file.
//
// React Native uses `testID` (camelCase, no dash), not `data-testid`:
//   import { LOGIN } from '../constants/testIds';
//   <TouchableOpacity testID={LOGIN.submitButton} onPress={...} />
//   <TextInput testID={LOGIN.emailInput} ... />
//
// Directive:
//   - Keys are camelCase, values are kebab-case shaped as `<feature>-<element>`
//     (or `<feature>-<element>-<qualifier>` when an element repeats). Examples:
//     'login-submit-button', 'cart-quantity-input', 'product-card-image'.
//
// Why kebab-case values: required by qabot's CSS-attribute-style selector
// matcher and the lint rule `emergent(kebab-case-testid-prop)`.

// AQSMS accounts have no email address: the Pi stores a username, a bcrypt
// password hash and a display name, nothing else. Registration creates the one
// farmer account and is closed afterwards.
//
// The sign-in screen currently sets its testIDs inline, so this file is
// documentation of the agreed names rather than a live import. The ids below
// match what app/sign-in.tsx actually renders.
export const LOGIN = {
	usernameInput: 'sign-in-username-input',
	passwordInput: 'sign-in-password-input',
	submitButton: 'sign-in-submit-button',
	togglePassword: 'sign-in-toggle-password',
	createAccountLink: 'login-create-account-link',
};

export const CREATE_ACCOUNT = {
	link: 'login-create-account-link',
	usernameInput: 'create-account-username-input',
	passwordInput: 'create-account-password-input',
	passwordConfirmInput: 'create-account-password-confirm-input',
	submitButton: 'create-account-submit-button',
	cancelLink: 'create-account-cancel-link',
	error: 'create-account-error',
};

export const LOGOUT = {
	button: 'logout-button',
};
