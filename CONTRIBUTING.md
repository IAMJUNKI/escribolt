# Contributing

Thanks for helping improve Escribolt. Please keep pull requests focused, explain the user-facing impact, and include screenshots for UI changes when useful.

Before opening a pull request, run the relevant checks:

```bash
npm run build
node --test public/meetingDetection.test.js public/sttFallbackPolicy.test.js public/stt/SttRouter.test.js public/llm/LlmRouter.test.js
```

## Contributor Terms

By submitting a contribution to this repository, you agree that:

- Your contribution is your original work, or you have the right to submit it.
- Your contribution is licensed under the GNU Affero General Public License v3.0 or later.
- You grant IAMJUNKI / Escribolt a perpetual, worldwide, non-exclusive, royalty-free, sublicensable, and transferable license to use, reproduce, modify, distribute, publicly perform, publicly display, prepare derivative works from, and relicense your contribution, including as part of commercial Escribolt offerings.

These terms keep the public project open source while preserving the ability to offer commercial licenses for companies that need proprietary embedding, closed-source modifications, white-label distribution, or other arrangements outside the AGPL.

For substantial contributions, Escribolt may ask you to sign a separate contributor license agreement before merging.
