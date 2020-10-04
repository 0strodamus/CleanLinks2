# CleanLinks2
Converts obfuscated/nested links to genuine clean links (Clean Links 2.0 fork).

This extension is a fork of Clean Links 2.0 for XUL designed to convert obfuscated/nested links to genuine/normal plain clean links.

_For example:_

- <http://www.foobar.com/track=ftp://gnu.org> ➠ <ftp://gnu.org/>

- <http://example.com/aHR0cDovL3d3dy5nb29nbGUuY29t> ➠ <http://www.google.com>

- javascript:window.open('http://somesite.com') ➠ <http://somesite.com/>

It also allows to remove affiliate/tracking tags from URLs by the use of configurable patterns.

I would like to thank [diegocr](https://github.com/diegocr/CleanLinks) for creating and sharing the original extension and [Cimbali](https://github.com/Cimbali/CleanLinks/commit/c1062584679cbe3aa7dfbf73e6fe4822e7de5bfc) for the initial unobfuscation commit.
