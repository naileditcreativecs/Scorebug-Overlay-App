# Team logo library selection for HTML scorebugs

The tightly cropped transparent logos are the app default. No HTML change is
needed to use them.

To make one HTML scorebug use the prior uncropped game-logo canvases, add
`data-cfb27-logo-library="original"` to its outer scorebug element:

```html
<div data-cfb27-scorebug data-cfb27-logo-library="original">
  <img id="awayLogo" data-cfb27-bind="away.logo" alt="">
  <img id="homeLogo" data-cfb27-bind="home.logo" alt="">
</div>
```

To force the cropped library even when a user has picked a different logo in
the app, use `data-cfb27-logo-library="cropped"` instead.

If the attribute is omitted, the app uses the user's saved logo choice for the
detected team. New installations start with the tightly cropped logo.
