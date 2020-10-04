/* ***** BEGIN LICENSE BLOCK *****
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/
 *
 * The Original Code is CleanLinks Mozilla Extension.
 *
 * The Initial Developer of the Original Code is
 * Copyright (C)2012 Diego Casorran <dcasorran@gmail.com>
 * All Rights Reserved.
 * 
 * The forked code is CleanLinks2 XUL Extension.
 * Copyleft (C)2020 0strodamus
 * 
 * ***** END LICENSE BLOCK ***** */

(function () {
	const Cc = Components.classes;
	const Ci = Components.interfaces;
	const Cu = Components.utils;
	var clMutationObsLoaded, // declared uninitialized global variables
			baddomsArray,
			baddomsRegexArray,
			clSiteStatus,
			sspdomsArray,
			sspdomsRegexArray;
	var	clHttpModReqLoaded = false; // declared and initialized (unlike clMutationObsLoaded, clHttpModReqLoaded always returns undefined)
	const cleanlinks = {
		attr_cleaned_count: 'data-cleanedlinks',
		attr_cleaned_link: 'data-cleanedlink',
		attr_uncleaned_link: 'data-uncleanedlink',
		str_cleanlink_touch: "CleanLinks Touch!",
		str_hashtag: '#',
		prefValues: null,
		prefBranch: null,
		observerService: Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService),
		handleEvent: function (evt) { // runs at browser launch
			window.removeEventListener(evt.type, arguments.callee, false);
			switch (evt.type) {
			case 'load':
				cleanlinks.prefBranch = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefService).getBranch('extensions.cleanlinks.');
				if ("nsIPrefBranch2" in Ci)
					cleanlinks.prefBranch.QueryInterface(Ci.nsIPrefBranch2);
				cleanlinks.prefValues = {};
				for (let p of cleanlinks.prefBranch.getChildList("", {})) {
					cleanlinks.prefValues[p] = cleanlinks.getPref(p);
					//cleanlinks.clDebugLog('CleanLinks2 Preference: '+p+' = '+cleanlinks.getPref(p));
				}
				cleanlinks.loadArrayPrefs();
				cleanlinks.loadRegexPrefs();
				if (cleanlinks.load(!!cleanlinks.prefValues.enabled)) {
					if (document.getElementById('cleanlinks-toolbar-button')) { // suppress null messages if toolbar button not present
						document.getElementById('cleanlinks-toolbar-button').addEventListener('click', cleanlinks.clBtnClickLstnr, false);
					}
					gBrowser.addEventListener('DOMContentLoaded', cleanlinks.onDocumentLoaded, false);
					gBrowser.tabContainer.addEventListener("TabSelect", cleanlinks.onTabSelected, false);
				}
				cleanlinks.prefBranch.addObserver("", cleanlinks, false);
				cleanlinks.observerService.addObserver(cleanlinks.clOptClickObs, "addon-options-displayed", false);
				break;
			case 'unload':
				cleanlinks.prefBranch.removeObserver("", cleanlinks);
				cleanlinks.observerService.removeObserver(cleanlinks.clOptClickObs, "addon-options-displayed");
				cleanlinks.clToggleObservers("off"); // stop Observers
				if (cleanlinks.prefValues.enabled) {
					if (document.getElementById('cleanlinks-toolbar-button')) { // suppress null messages if toolbar button not present
						document.getElementById('cleanlinks-toolbar-button').removeEventListener('click', cleanlinks.clBtnClickLstnr, false);
					}
					if (gBrowser.contentDocument.getElementById('cleanlinks-resetoptions-button')) { // suppress null messages if toolbar button not present
					gBrowser.contentDocument.getElementById('cleanlinks-resetoptions-button').removeEventListener('click', cleanlinks.clResetOptions, false);
					}
					gBrowser.tabContainer.removeEventListener("TabSelect", cleanlinks.onTabSelected, false);
					gBrowser.removeEventListener('DOMContentLoaded', cleanlinks.onDocumentLoaded, false);
				}
			default:
				break;
			}
		},
		onDocumentLoaded: function (evt) {
			var delaytime = parseFloat(cleanlinks.prefValues.cleandelay) * 1000;
			//console.log('CleanLinks2: delaytime: '+delaytime);
			setTimeout( function(){ // delay start because both 'load' and 'onDocumentLoaded' fire too quickly to consistently detect embedded elements
			try { // wrap in a try statement to avoid "TypeError: can't access dead object" when tab is closed before delay expires
				if (evt.originalTarget instanceof HTMLDocument) {
					cleanlinks.countCleanLinksInDoc(evt.originalTarget);
					cleanlinks.clToggleObservers("on"); // links have been cleaned - start Observers
				}
			} catch (e) {}
		 }, delaytime);
		},
		countCleanLinksInDoc: function (doc, isInnerDoc) {
			// doc returns undefined or [object HTMLDocument] or 0 when called by prefs observer when toolbar icon toggled to enabled
			// isInnerDoc returns undefined unless called by prefs observer when toolbar icon toggled to enabled
			let clDocObject, // returns undefined or [object HTMLDocument] when toolbar icon toggled to enabled
					nCleanedLinks = 0,
					clFrameCount; // undefined or -1 when toolbar icon toggled to enabled
			if (!doc)
				doc = this.getDocument();
			if (!doc.body)
				return;
			nCleanedLinks = this.cleanLinksInDoc(doc); // calls cleanLinksInDoc function
			if (isInnerDoc) {
				let frames = doc.getElementsByTagName('iframe'),
						clFrameCount = frames.length;
				while (clFrameCount--) {
					clDocObject = frames[clFrameCount].contentWindow.document;
					if (clDocObject instanceof HTMLDocument)
						nCleanedLinks += this.countCleanLinksInDoc(clDocObject, 2);
				}
				if (isInnerDoc == 2)
					return nCleanedLinks;
			}
			while (doc.defaultView.frameElement) {
				doc = doc.defaultView.top.document;
			}
			if (doc.body) {
				if (doc.body.hasAttribute(this.attr_cleaned_count))
					nCleanedLinks += parseInt(doc.body.getAttribute(this.attr_cleaned_count));
				doc.body.setAttribute(this.attr_cleaned_count, nCleanedLinks);
			}
			this.updateToolbarCounter(doc, nCleanedLinks); // doc = [object HTMLDocument] or [object XULDocument], nCleanedLinks = # of cleaned links
			//cleanlinks.clDebugLog('countCleanLinksInDoc: doc = '+doc+'\n>  nCleanedLinks = '+nCleanedLinks);
			return nCleanedLinks;
		},
		UndoCleanLinksInDoc: function (doc, isInnerDoc) {
			if (!doc)
				doc = this.getDocument();
			if (!doc.body)
				return;
			let links = doc.getElementsByTagName('a'),
					nlinksCount = links.length;
			while (nlinksCount--) {
				if (links[nlinksCount].hasAttribute(this.attr_uncleaned_link)) { // links[nlinksCount] = cleaned links array
					links[nlinksCount].setAttribute('href', links[nlinksCount].getAttribute(this.attr_uncleaned_link)); // restore uncleaned URLs
					if (this.prefValues.decorate) {
						links[nlinksCount].style.setProperty('border-bottom', '0px', 'important'); // clears dotted line added to cleaned URLs
					}
					links[nlinksCount].removeAttribute(this.attr_cleaned_link); // remove all attributes that were added to cleaned URLs
					links[nlinksCount].removeAttribute(this.attr_uncleaned_link);
					if (this.prefValues.tooltip) {
						links[nlinksCount].removeAttribute('title'); // remove "CleanLinks Touch!" tooltip
					}
					if (this.prefValues.highlight)
						links[nlinksCount].style.background = links[nlinksCount].style.color = null;
				}
			}
			let frames = doc.getElementsByTagName('iframe'),
					nframesCount = frames.length;
			while (nframesCount--) {
				let clDocObject = frames[nframesCount].contentWindow.document;
				if (clDocObject instanceof HTMLDocument)
					this.UndoCleanLinksInDoc(clDocObject, 2);
			}
			if (isInnerDoc)
				return;
			doc.body.setAttribute(this.attr_cleaned_count, 0);
			this.updateToolbarCounter(doc);
		},
		onTabSelected: function (evt) {
			if (!(evt.originalTarget instanceof XULElement))
				return;
			if (!cleanlinks.prefValues.enabled)
				cleanlinks.UndoCleanLinksInDoc();
			else {
				cleanlinks.countCleanLinksInDoc();
				// Reconnect to the Mutation Observer when returning to a previous tab due to possible disconnecting while
				// cleaning in clMutationObs(). All tabs return about:blank the 1st time they're opened and return the actual
				// correct URI when returned to. Leverage this to exclude reconnecting until returning.
				doc = cleanlinks.getDocument();
				if (doc instanceof HTMLDocument && doc.documentURI !== 'about:blank') {
					if (typeof clMutationObsLoaded != 'undefined') {
						clMutationObsLoaded.observe(doc, { attributes: true, childList: true, subtree: true }); // start observing
						//console.log('CleanLinks2: Mutation Observer was connected');
					}
				}
			}
		},
		updateToolbarCounter: function (doc, count) {
			if (!doc)
				doc = this.getDocument();
			var activeWin = this.getWinDocument(activeWin);
			//cleanlinks.clDebugLog('CleanLinks2 updateToolbarCounter activeWin: '+activeWin); // returns [object XULDocument]
			if (activeWin != doc) {
				return;
			}
			if (!(doc = doc.body))
				return;
			doc = count || parseInt(doc.getAttribute(this.attr_cleaned_count));
			if (typeof doc != 'undefined' && doc != 0) {
        if (document.getElementById('cleanlinks-toolbar-button')) { // suppress null messages if toolbar button not present
					document.getElementById('cleanlinks-toolbar-button').setAttribute('cl_active',true); // cleaned links exist, set icon active
				}
			} else {
				if (document.getElementById('cleanlinks-toolbar-button')) { // suppress null messages if toolbar button not present
					document.getElementById('cleanlinks-toolbar-button').removeAttribute('cl_active');
				}
			}
		},
		cleanLinksInDoc: function (doc) {
			let nCleanedLinks = 0,
					links = doc.getElementsByTagName('a'),
					nLinks = links.length,
					skipwhen = this.prefValues.skipwhen,
					removewhen = this.prefValues.removewhen,
					skipdoms = this.prefValues.skipdoms,
					baddoms = this.prefValues.baddoms,
					bypassdoms = this.prefValues.bypassdoms,
					sitespecdoms = this.prefValues.sitespecdoms,
					currDomain = this.getWinDocument().location.hostname;
			if (nLinks > 0) { // don't run bypassdoms or baddoms if there are no links to clean
				// disable all cleaning on bypassdoms domains
				if (bypassdoms) { // true when bypassdoms is not empty (same as bypassdoms !== "")
					for (let i = 0; i < bypassdoms.length; i++) {
						let bypassdomsItem = bypassdoms[i];
						if (currDomain.indexOf(bypassdomsItem) !== -1) { // finding bypassdomsItem within currDomain returns true
							// could use ES6 currDomain.includes(bypassdomsItem) - use method includes() for strings and test() for regex
							//console.log('bypassdoms match found: '+bypassdomsItem+' = '+currDomain);
							if (this.prefValues.logging) {
								cleanlinks.clLog('Trusted Domain item "'+bypassdomsItem+'" matched. All cleaning disabled.');
							}
							clSiteStatus = "Trusted Site"; // set toolbar icon tooltip site trust
							return nCleanedLinks; // we have a match, bail out of all cleaning
						}
					}
				}
				// aggressive cleaning for egregious websites
				if (baddoms) { // true when baddoms is not empty (same as baddoms !== "")
					for (let i = 0; i < baddomsArray.length; i++) {
						let baddomsDomainItem = baddomsArray[i],
								baddomsRegexItem = baddomsRegexArray[i];
						if (currDomain.indexOf(baddomsDomainItem) !== -1) { // finding baddomsDomainItem within currDomain returns true
							//console.log('baddoms match found: '+baddomsDomainItem+' = '+currDomain);
							baddomsLoop: while (nLinks--) { // label while statement so we can exit nested loops to here
								let h = links[nLinks].href,
										ht = null;
								// site-specific cleaning
								if (sitespecdoms) {
									for (let i = 0; i < sspdomsArray.length; i++) {
										let sspdomsDomainItem = sspdomsArray[i],
												sspdomsRegexItem = sspdomsRegexArray[i];
										if ((h.indexOf(sspdomsDomainItem) !== -1) && sspdomsRegexItem.test(h)) {
											++nCleanedLinks;
											if (~(p = h.indexOf('#'))) // ~ is bit-wise NOT
												(ht = h.substr(p), h = h.substr(0, p));
											h = h.replace('&amp;', '&', 'g').replace(sspdomsRegexItem, '').replace(/[?&]$/, '') + (ht || this.str_hashtag);
											if (this.prefValues.logging) {
												cleanlinks.clLog('Site Specific Original URL: '+links[nLinks].href+'\n>            Site Specific Cleaned URL: '+h); // log cleaned URLs
											}
											this.clLinkAttribs(links, nLinks, h); // add attributes, styling, and tooltip
										}
									}
								}
								// skip cleaning regex
								if ((skipwhen && skipwhen.test(h)) || (baddomsRegexItem && baddomsRegexItem.test(h))) {
									if (this.prefValues.logging) {
										cleanlinks.clLog('"Skip Links" or "Untrusted Domain skip" regex match found.\n>            Link "'+h+'" will not be cleaned.');
									}
									continue baddomsLoop; // start next (nLinks--) iteration because something in skipwhen setting matched URL (h)
								}
								// skip cleaning links matching skipdoms domain text search
								if (skipdoms) { // true when skipdoms is not empty (same as skipdoms !== "")
									for (let i = 0; i < skipdoms.length; i++) {
										let skipdomsItem = skipdoms[i];
										if (h.indexOf(skipdomsItem) !== -1) { // finding skipdomsItem within h (URL) returns true
											//console.log('skipdoms match found: '+skipdomsItem+' = '+h);
											if (this.prefValues.logging) {
												cleanlinks.clLog('Skip Domains item "'+skipdomsItem+'" matched within link "'+h+'" and will not be cleaned.'); // log skipdom matches
											}
											continue baddomsLoop; // start next (nLinks--) iteration because something in skipdoms setting matched URL (h)
										}
									}
								}
								if (/\?/g.test(h)) { // only strip links that actually contain tags
									++nCleanedLinks;
									h = h.replace(/\?\w+=.*/g, '#'); // we have a match, aggressively clean
									if (this.prefValues.logging) {
										cleanlinks.clLog('Untrusted Domain Original URL: '+links[nLinks].href+'\n>            Untrusted Domain Cleaned URL: '+h); // log cleaned URLs
									}
									this.clLinkAttribs(links, nLinks, h); // add attributes, styling, and tooltip
								}
							} // baddomsLoop finished
							clSiteStatus = "Untrusted Site"; // set toolbar icon tooltip site trust
							return nCleanedLinks; // cleaned links counter
						}
					}
				}
			}
			cleaningLoop: while (nLinks--) { // label while statement so we can exit nested loops to here
				let h = links[nLinks].href,
						lmt = 4,
						s = 0,
						p,
						ht = null;
				//console.log('CleanLinks2 cleanLinksInDoc h: '+h); // returns all links in document
				// site-specific cleaning
				if (sitespecdoms) {
					for (let i = 0; i < sspdomsArray.length; i++) {
						let sspdomsDomainItem = sspdomsArray[i],
								sspdomsRegexItem = sspdomsRegexArray[i];
						if ((h.indexOf(sspdomsDomainItem) !== -1) && sspdomsRegexItem.test(h)) {
							++nCleanedLinks;
							if (~(p = h.indexOf('#'))) // ~ is bit-wise NOT
								(ht = h.substr(p), h = h.substr(0, p));
							h = h.replace('&amp;', '&', 'g').replace(sspdomsRegexItem, '').replace(/[?&]$/, '') + (ht || this.str_hashtag);
							if (this.prefValues.logging) {
								cleanlinks.clLog('Site Specific Original URL: '+links[nLinks].href+'\n>            Site Specific Cleaned URL: '+h); // log cleaned URLs
							}
							this.clLinkAttribs(links, nLinks, h); // add attributes, styling, and tooltip
						}
					}
				}
				// skip cleaning links matching skipdoms domain text search
				if (skipdoms) { // true when skipdoms is not empty (same as skipdoms !== "")
					for (let i = 0; i < skipdoms.length; i++) {
						let skipdomsItem = skipdoms[i];
						if (h.indexOf(skipdomsItem) !== -1) { // finding skipdomsItem within h (URL) returns true
							//console.log('skipdoms match found: '+skipdomsItem+' = '+h);
							if (this.prefValues.logging) {
								cleanlinks.clLog('Skip Domains item "'+skipdomsItem+'" matched within link "'+h+'" and will not be cleaned.'); // log skipdom matches
							}
							continue cleaningLoop; // start next (nLinks--) iteration because something in skipdoms setting matched URL (h)
						}
					}
				}
				// skip cleaning regex
				if (skipwhen && skipwhen.test(h)) {
					if (this.prefValues.logging) {
						cleanlinks.clLog('Skip Links regex match found. Link "'+h+'" will not be cleaned.'); // log skipdom matches
					}
					continue cleaningLoop; // start next (nLinks--) iteration because something in skipwhen setting matched URL (h)
				}
				// redirect cleaning
				// --- begin redirect cleaning fixes ---
				if (h.indexOf("tweetembed") !== -1) {
					h = h.replace(/&ref_url=.*/, '');
				}
				if (h.indexOf("?referer=https%3A%2F%2F") !== -1) {
				h = h.replace(/\?referer=.+%2F/, '');
				//http://www.bbc.com/travel/story/20200914-in-guatemala-the-maya-world-untouched-for-centuries?referer=https%3A%2F%2Fwww.bbc.com%2F?utm_source=digg
				}
				// --- end redirect cleaning fixes ---
				h.replace(/^javascript:.+(["'])(https?(?:\:|%3a).+?)\1/gi, function (a, b, c)(++s, h = c));
					if (/((?:aHR0|d3d3)[A-Z0-9+=\/]+)/gi.test(h))
						try {
							h = '=' + decodeURIComponent(atob(RegExp.$1));
						} catch (e) {
								Cu.reportError('Invalid base64 data for "'+h+'" at "'+(b&&b.spec)+'"\n> '+e);
						}
					while (--lmt && (/[\/\?\=\(]([hft]+tps?(?:\:|%3a).+)$/i.test(h) || /(?:[\?\=]|[^\/]\/)(www\..+)$/i.test(h))) {
						h = RegExp.$1;
						if (~(p = h.indexOf('&')))
							h = h.substr(0, p);
						h = decodeURIComponent(h);
						if (~(p = h.indexOf('html&')) || ~(p = h.indexOf('html%')))
							h = h.substr(0, p + 4);
						else if (~(p = h.indexOf('/&')) || ~(p = h.indexOf('/%')))
							h = h.substr(0, p);
						if (!/^http/.test(h))
							h = 'http://' + h;
						if (h.indexOf('/', 8) == -1)
							h += '/';
						++s;
						++nCleanedLinks; // include cleaned redirects in cleaned links counter
						if (this.prefValues.logging) {
							cleanlinks.clLog('Original Redirect: '+links[nLinks].href+'\n>            Cleaned Redirect: '+h); // log cleaned redirects
						}
					}
				// normal cleaning
				if (s || removewhen.test(h)) {
					++nCleanedLinks;
					if (~(p = h.indexOf('#'))) // ~ is bit-wise NOT
						(ht = h.substr(p), h = h.substr(0, p));
					h = h.replace('&amp;', '&', 'g').replace(removewhen, '').replace(/[?&]$/, '') + (ht || this.str_hashtag);
					if (this.prefValues.logging) { // log if enabled
						cleanlinks.clLog('Original URL: '+links[nLinks].href+'\n>            Cleaned URL: '+h); // log cleaned URLs
					}
					this.clLinkAttribs(links, nLinks, h); // add attributes, styling, and tooltip
				}
			} // cleaningLoop finished
			clSiteStatus = ""; // clear toolbar icon tooltip site trust
			return nCleanedLinks; // cleaned links counter
		},
		clLinkAttribs: function (links, nLinks, h) {
			if (!(links[nLinks].hasAttribute(this.attr_uncleaned_link))) { // set uncleaned attribute only on first pass
				links[nLinks].setAttribute(this.attr_uncleaned_link, links[nLinks].href);
			}
			links[nLinks].setAttribute(this.attr_cleaned_link, h); // set cleaned attribute on every pass
			if (this.prefValues.tooltip !== "disabled") { // show tooltip if enabled with chosen style
				let m = links[nLinks].hasAttribute('title') ? links[nLinks].getAttribute('title') : '';
				m += this.str_cleanlink_touch;
				if (this.prefValues.tooltip == "detailed") {
					let clUncleanedLink = links[nLinks].getAttribute(this.attr_uncleaned_link); // get original uncleaned link
					links[nLinks].setAttribute('title', '-------- CleanLinks2! --------\n'+clUncleanedLink+'\n------- Cleaned Link ------->\n '+h);
				}
				if (this.prefValues.tooltip == "classic") {
					links[nLinks].setAttribute('title', m);
				}
			}
			links[nLinks].setAttribute('href', h); // set cleaned URL
			if (this.prefValues.decorate) {
				links[nLinks].style.setProperty('border-bottom', '1px dotted #9f9f8e', 'important');
			}
			if (this.prefValues.highlight) {
				var hlstyleArray = this.prefValues.hlstyle.split(';'); // create array from semicolon-delimited hlstyle setting
				for (let i = 0; i < hlstyleArray.length; i++) {
					let [hlAttrib,hlVal] = hlstyleArray[i].split(':').map(String.trim); // split style attribute and value for setProperty method
					links[nLinks].style.setProperty(hlAttrib, hlVal, 'important');
				}
			}
			return;
		},
		getPref: function (clPrefName, clPrefVal) {
			let p = this.prefBranch;
			if (typeof clPrefVal == 'undefined') {
				let s = Ci.nsIPrefBranch;
				clPrefName = clPrefName || 'enabled';
				try {
					switch (p.getPrefType(clPrefName)) {
					case s.PREF_STRING:
						return p.getCharPref(clPrefName);
					case s.PREF_INT:
						return p.getIntPref(clPrefName);
					case s.PREF_BOOL:
						return p.getBoolPref(clPrefName);
					}
				} catch (e) {}
			} else {
				try {
					switch (typeof(clPrefVal)) {
					case "string":
						p.setCharPref(clPrefName, clPrefVal);
						break;
					case "boolean":
						p.setBoolPref(clPrefName, clPrefVal);
						break;
					case "number":
						p.setIntPref(clPrefName, clPrefVal);
						break;
					}
				} catch (e) {}
			}
		},
		clBtnClickLstnr: function (event) {
			if (event.ctrlKey) {
				event.preventDefault(); // cancel the normal toolbar button click
				event.stopPropagation();
				try { // open the cleanlinks settings tab
				Cc["@mozilla.org/appshell/window-mediator;1"]
					.getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser")
					.BrowserOpenAddonsMgr("addons://detail/{158d7cb3-7039-4a75-8e0b-3bd0a464edd2}/preferences");
				} catch (e) {
						alert('Error Opening CleanLinks2 Settings: ' + e.message);
				}
			}
		},
		clResetOptions: function (event) {
			if (event) {
				try {
          for (let p of cleanlinks.prefBranch.getChildList("", {})) {
						if (p != 'enabled') { // reset all preferences, except enabled state
						cleanlinks.prefValues[p] = cleanlinks.prefBranch.clearUserPref(p);
						//console.log('CleanLinks2 Preference '+k+' reset.');
						cleanlinks.prefValues[p] = cleanlinks.getPref(p); // reload preferences
						}
					}
				cleanlinks.loadArrayPrefs(); // reload array and regex preferences
				cleanlinks.loadRegexPrefs();
				}
				catch (e) {
					alert('Error clearing CleanLinks2 options: ' + e.message);
				}
			}
		},
		clOptClickObs: { // options page observer (needed for "Reset Options" button)
			observe: function (aSubject, aTopic, aData) {
				// aSubject = [object XULDocument], aTopic = addon-options-displayed (fixed notification triggered by options pages), aData = addon's ID
				if (aTopic == "addon-options-displayed" && aData == "{158d7cb3-7039-4a75-8e0b-3bd0a464edd2}") { // CleanLink's options page only
					//console.log('CleanLinks2: clOptClickObs is on cleanlinks options page');
					aSubject.getElementById('cleanlinks-resetoptions-button').addEventListener('click', cleanlinks.clResetOptions, false);
				}
			}
		},
		load: function (clBtnEvent) { // runs on browser launch and on toolbar button clicks
			//console.log('CleanLinks2: load function called, clBtnEvent = '+clBtnEvent);
				/* returns true if enabled on 1st load
				 * returns undefined, then false when icon clicked disabled
				 * returns undefined, then true when icon clicked enabled
				 * returns [object MouseEvent] when hovered
				 */ 
			if (typeof clBtnEvent == 'object') {
				let toolTip = clBtnEvent.target;
				if (toolTip.hasChildNodes()) {
					let ttCount = toolTip.childNodes.length;
					while (ttCount--)
						toolTip.removeChild(toolTip.childNodes[ttCount]);
				}
				let cleanedCount;
				try {
					cleanedCount = parseInt(cleanlinks.getWinDocument().body.getAttribute(cleanlinks.attr_cleaned_count));
					if (isNaN(cleanedCount))
						cleanedCount = 0;
				} catch (e) {
						cleanedCount = 0;
				}
				try {
					toolTip.appendChild(cleanlinks.objectCreate('label', {
						value: 'CleanLinks2',
						style: 'text-align:center;color:#4276c2;font:12px Arial,Serif;font-weight:bold'
					}));
					toolTip.appendChild(cleanlinks.objectCreate('separator', {
						height: 1,
						style: 'background-color:#333;margin-bottom:3px'
					}));
					toolTip.appendChild(cleanlinks.objectCreate('label', {
						value: 'Status: ' + (cleanlinks.getPref() ? 'Enabled' : 'Disabled'),
						style: 'text-align:center'
					}));
					toolTip.appendChild(cleanlinks.objectCreate('label', {
						value: 'Cleaned Links: ' + cleanedCount,
						style: 'text-align:center'
					}));
					if (clSiteStatus == "Trusted Site") {
						toolTip.appendChild(cleanlinks.objectCreate('label', {
							value: clSiteStatus,
							style: 'text-align:center;color:green;font-weight:bold'
						}));
					}
					if (clSiteStatus == "Untrusted Site") {
						toolTip.appendChild(cleanlinks.objectCreate('label', {
							value: clSiteStatus,
							style: 'text-align:center;color:red;font-weight:bold'
						}));
					}
					toolTip.appendChild(cleanlinks.objectCreate('separator', {
						height: 1,
						style: 'background-color:#333;margin-bottom:3px'
					}));
					toolTip.appendChild(cleanlinks.objectCreate('label', {
						value: 'Click the icon to ' + (cleanlinks.getPref() ? 'Disable' : 'Enable'),
						style: 'text-align:center;color:#767676;font:9px Arial,Serif'
					}));
					toolTip.appendChild(cleanlinks.objectCreate('label', {
						value: 'Ctrl-click opens Settings',
						style: 'text-align:center;color:#767676;font:9px Arial,Serif'
					}));
				} catch (e) {
						alert(e);
						return false;
				}
				return true;
			}
			this.getPref('enabled', clBtnEvent = (typeof clBtnEvent != 'undefined' ? !!clBtnEvent : !this.getPref()));
			//console.log('CleanLinks2: load function , clBtnEvent = '+clBtnEvent);
				/* returns true if enabled on 1st load
				 * returns false (not undefined) when icon clicked disabled
				 * returns true (not undefined) when icon clicked enabled
				 * returns nothing when hovered
				 */ 
			if (!clBtnEvent) {
				document.getElementById('cleanlinks-toolbar-button').setAttribute('cl_disabled',true); // set icon disabled
			} else {
				if (document.getElementById('cleanlinks-toolbar-button')) { // suppress null messages if toolbar button not present
					document.getElementById('cleanlinks-toolbar-button').removeAttribute('cl_disabled');
				}
			}
			return clBtnEvent;
		},
		observe: function (aDocument, clIsPrefChanged, clIsEnabled) { // observer to detect preference changes
			//console.log('CleanLinks2: aDocument = '+aDocument+' clIsPrefChanged = '+clIsPrefChanged+' clIsEnabled = '+clIsEnabled);
			/* aDocument returns [xpconnect wrapped (nsISupports, nsIPrefBranch, nsIPrefBranch2)]
			 * clIsPrefChanged returns nsPref:changed
			 * clIsEnabled returns enabled
			 */
			switch (clIsPrefChanged) {
			case 'nsPref:changed':
				this.prefValues[clIsEnabled] = this.getPref(clIsEnabled);
				if (clIsEnabled == 'enabled') {
					if (this.load(!!this.prefValues[clIsEnabled])) { // toolbar icon toggled to enabled
						document.getElementById('cleanlinks-toolbar-button').addEventListener('click', cleanlinks.clBtnClickLstnr, false);
						gBrowser.addEventListener('DOMContentLoaded', this.onDocumentLoaded, false);
						gBrowser.tabContainer.addEventListener("TabSelect", this.onTabSelected, false);
						this.countCleanLinksInDoc(0, 1);
						cleanlinks.clToggleObservers("on"); // links have been cleaned - start Observers
					} else { // toolbar icon toggled to disabled
						gBrowser.removeEventListener('DOMContentLoaded', this.onDocumentLoaded, false);
						gBrowser.tabContainer.removeEventListener("TabSelect", this.onTabSelected, false);
						cleanlinks.clToggleObservers("off"); // stop Observers prior to restoring original links
						this.UndoCleanLinksInDoc();
						}
				} else { // triggered when edits are made to about:addons preferences
					if (~['baddoms', 'bypassdoms', 'sitespecdoms', 'skipdoms'].indexOf(clIsEnabled)) {
					this.loadArrayPrefs();
					}
				  if (~['skipwhen', 'removewhen'].indexOf(clIsEnabled)) {
					this.loadRegexPrefs();
					}
				}
			default:
				break;
			}
		},
		clToggleObservers: function(ObserverState) {
			if (ObserverState == "on") {
				doc = cleanlinks.getDocument();
				if (cleanlinks.prefValues.mutationobserver) { // stop Mutation Observer if it is enabled
					if (typeof clMutationObsLoaded == 'undefined') { // enable Mutation Observer if needed
						clMutationObsLoaded = new MutationObserver(cleanlinks.clMutationObs);
						//console.log('CleanLinks2: Mutation Observer was loaded');
					}
					clMutationObsLoaded.observe(doc, { attributes: true, childList: true, subtree: true }); // start observing
					//console.log('CleanLinks2: Mutation Observer was connected');
				}
				if (!cleanlinks.prefValues.mutationobserver && typeof clMutationObsLoaded != 'undefined') { // stop Mutation Observer if it was disabled
					clMutationObsLoaded.disconnect();
					//console.log('CleanLinks2: Mutation Observer was disconnected');
				}
				if (cleanlinks.prefValues.wpmodobserver && clHttpModReqLoaded == false) { // start http-on-modify-request observer if it is enabled and not loaded
					cleanlinks.observerService.addObserver(cleanlinks.clHttpModReq, "http-on-modify-request", false);
					clHttpModReqLoaded = true;
					//console.log('CleanLinks2: http-on-modify-request Observer was added');
				}
				if (!cleanlinks.prefValues.wpmodobserver && clHttpModReqLoaded == true) { // remove http-on-modify-request observer if it is disabled and loaded
					cleanlinks.observerService.removeObserver(cleanlinks.clHttpModReq, "http-on-modify-request");
					clHttpModReqLoaded = false;
					//console.log('CleanLinks2: http-on-modify-request Observer was removed');
				}
			}
			if (ObserverState == "off") {
				if (typeof clMutationObsLoaded != 'undefined') {
					clMutationObsLoaded.disconnect(); // stop observing
					//console.log('CleanLinks2: Mutation Observer was disconnected');
				}
				if (clHttpModReqLoaded == true) { // remove http-on-modify-request observer if it is loaded
					cleanlinks.observerService.removeObserver(cleanlinks.clHttpModReq, "http-on-modify-request");
					clHttpModReqLoaded = false;
					//console.log('CleanLinks2: http-on-modify-request Observer was removed');
				}
			}
		},
		objectCreate: function (xulElementName, attributes) {
			const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
			xulElementName = document.createElementNS(XUL_NS, xulElementName);
			if (!xulElementName)
				return null;
			if (attributes)
				for (let attrName in attributes) {
					xulElementName.setAttribute(attrName, attributes[attrName]);
				}
			return xulElementName;
		},
		loadArrayPrefs: function () {
			// load string preference values for bypassdoms, baddoms, sitespecdoms, and skipdoms into arrays
			for (var p of ['baddoms', 'bypassdoms', 'sitespecdoms', 'skipdoms']) {
				if (this.prefValues[p] && typeof this.prefValues[p] == 'string') {
					this.prefValues[p] = this.getPref(p); // needed to prevent "TypeError: this.prefValues[p].split is not a function" when editing preferences
					this.prefValues[p] = this.prefValues[p].split(',').map(String.trim).filter(String); // create array from comma-delimited string
					//console.log('CleanLinks2 preference array: '+p+' = '+this.prefValues[p]);
				}
				if (this.prefValues[p] != '' && typeof this.prefValues[p] == 'string') { // make sure preference is now an array object
					console.log('Error processing CleanLinks2 array: '+p+'.');
				}
			}
			for (var p of ['baddoms', 'sitespecdoms']) { // split domain and regex values for baddoms and sitespecdoms into separate arrays
				tempDomainArray = new Array(); // create new temporary arrays to populate
				tempRegexArray = new Array();
				for (let i = 0; i < this.prefValues[p].length; i++) {
					let tempItem = this.prefValues[p][i];
					if (/\(/.test(tempItem)) { // test for regex
						var tempItemArray = tempItem.split(/\((.+)/); // use regex to only split on the first parenthesis
						if (tempItemArray[1] != undefined) {
							tempDomainArray.push(tempItemArray[0]); // add domain to array
							var tempRegexItem = tempItemArray[1].replace(/\)$/, ''); // remove trailing parenthesis
							try {
								if (p == 'baddoms') {
									tempRegexItem = new RegExp(tempRegexItem); // create skip regex
								}
								if (p == 'sitespecdoms') {
									tempRegexItem = new RegExp('\\b(' + tempRegexItem + ')=.+?(&|$)', 'gi'); // create remove regex
								}
								tempRegexArray.push(tempRegexItem); // add regex to array
							} catch (e) {
									if (p == 'baddoms') {
										var pErrorMsg = '"Untrusted Domains"';
									}
									if (p == 'sitespecdoms') {
										var pErrorMsg = '"Site Specific Remove From Links"';
									}
									alert('Error processing CleanLinks2 ' + pErrorMsg + ' pattern "' + tempRegexItem + '": ' + e.message + '.');
									tempRegexArray.push(""); // replace bad regex with empty string
									return; // exit to avoid repeated error messages
							}
						}
					} else { // no skip regex attached to baddoms domain
							if (p == 'baddoms') {
							tempDomainArray.push(tempItem);
							tempRegexArray.push("");
							}
					}
				}
				if (p == 'baddoms') { // load baddoms global variables
					baddomsArray = tempDomainArray;
					baddomsRegexArray = tempRegexArray;
					//console.log('CleanLinks2 baddomsArray: '+baddomsArray);
					//console.log('CleanLinks2 baddomsRegexArray: '+baddomsRegexArray);
					// make sure baddoms variables are now array objects
					if ((baddomsArray !== "" && typeof baddomsArray == 'string') || (baddomsRegexArray !== "" && typeof baddomsRegexArray == 'string')) {
						console.log('Error processing CleanLinks2 "Untrusted Domains" domain or regex array.');
					}
				}
				if (p == 'sitespecdoms') { // load sitespecdoms global variables
					sspdomsArray = tempDomainArray;
					sspdomsRegexArray = tempRegexArray;
					//console.log('CleanLinks2 sspdomsArray: '+sspdomsArray);
					//console.log('CleanLinks2 sspdomsRegexArray: '+sspdomsRegexArray);
					// make sure sitespecdoms variables are now array objects
					if ((sspdomsArray !== "" && typeof sspdomsArray == 'string') || (sspdomsRegexArray !== "" && typeof sspdomsRegexArray == 'string')) {
						console.log('Error processing CleanLinks2 "Site Specific Remove From Links" domain or regex array.');
					}
				}
			}
		},
		loadRegexPrefs: function () {
			// converts preference values for skipwhen (add leading and trailing /) and removewhen (add leading "/\b(" and trailing ")=.+?(&|$)/gi") into regex syntax
			for (var p of ['skipwhen', 'removewhen']) {
				if (this.prefValues[p] && typeof this.prefValues[p] == 'string')
					try {
						if (p == 'removewhen')
							this.prefValues[p] = new RegExp('\\b(' + this.prefValues[p] + ')=.+?(&|$)', 'gi'); // g = match all occurrences, i = case-insensitive
						else
							this.prefValues[p] = new RegExp(this.prefValues[p]);
					//cleanlinks.clDebugLog('CleanLinks2 Regex Preference: '+p+' = '+this.prefValues[p]);
					} catch (e) {
							alert('Error Processing CleanLinks2 Pattern "' + p + '": ' + e.message);
							this.prefValues[p] = null;
					}
			}
		},
		getDocument: function () {
			try {
				return gBrowser.contentDocument;
			}
			catch (e) {
				return this.getWinDocument() || window.content.document;
			}
		},
		getWindow: function (m) {
			try {
				var wm = Cc["@mozilla.org/appshell/window-mediator;1"].getService(Components.interfaces.nsIWindowMediator).getMostRecentWindow("navigator:browser");
				if (m)
					return wm;
				return wm.getBrowser();
			} catch (e) {
					return null;
			}
		},
		getWinDocument: function () {
			try {
				return this.getWindow().mCurrentBrowser.contentDocument;
			} catch (e) {
					return null;
			}
		},
		winLocation: function () {
			try {
				return this.getWinDocument().location;
			} catch (e) {
					return null;
			}
		},
		clHttpModReq: { // observer to rescan webpages on modification
			observe: function (aSubject, aTopic, aData) { // aSubject = [xpconnect wrapped nsISupports], aTopic = http-on-modify-request, aData = null
				doc = cleanlinks.getDocument();
				if (cleanlinks.prefValues.enabled && doc instanceof HTMLDocument) { // clean if enabled and on webpage
					if (aTopic == "http-on-modify-request") {
						//console.log('CleanLinks2: http-on-modify-request observer has detected a webpage change');
						cleanlinks.countCleanLinksInDoc(doc); // reclean
					}
				}
			}
		},
		clMutationObs: function(mutations) { // clMutationObs = callback function to execute when mutations are observed
			doc = cleanlinks.getDocument();
			if (cleanlinks.prefValues.enabled && doc instanceof HTMLDocument) { // clean if enabled and on webpage
				for (let mutation of mutations) {
					if (mutation.type === 'attributes') {
						if (mutation.target.nodeName.toLowerCase() === 'a' && mutation.attributeName === 'href') {
							//console.log('CleanLinks2: Mutation Observer mutation.target: '+mutation.target);
							if (cleanlinks.prefValues.logging) {
								cleanlinks.clLog('Mutation Observer Detected a Change to URL: '+mutation.target.href);
							}
							/* disconnecting/reconnecting the observer means less trips through the cleaning function
							 * (for example, 2 vs. 9 on https://www.bing.com/covid), however previously opened tabs are no
							 * longer monitored, unless refreshed (added code to onTabSelected() to compensate for this) */
							clMutationObsLoaded.disconnect(); // stop observing
							cleanlinks.countCleanLinksInDoc(doc); // reclean
							clMutationObsLoaded.observe(doc, { attributes: true, childList: true, subtree: true }); // resume observing
						}
					}
				}
			}
		},
		clLog: function (msg) { // simple logging
			Cc['@mozilla.org/consoleservice;1'].getService(Ci.nsIConsoleService).logStringMessage('CleanLinks2: ' + msg)
			// log example1: cleanlinks.clLog('logging message');
			// log example2: cleanlinks.clLog(link+'\n> '+clt);
		},
		clDebugLog: function (msg) { // complex logging
			Cc['@mozilla.org/consoleservice;1'].getService(Ci.nsIConsoleService).logStringMessage(msg = 'CleanLinks2' + ' Message @ '
			+ (new Date()).toISOString() + "\n> " + (Array.isArray(msg) ? msg.join("\n> ") : msg)
			+ "\n" + new Error().stack.split("\n").map(s => s.replace(/^(.*@).+\//, '$1'))
			.join("\n"), dump(msg + "\n"), console.log(msg))
		},
	};
	if (!("diegocr" in window))
		window.diegocr = {};
	window.diegocr.cleanlinks = cleanlinks;
	window.addEventListener('unload', cleanlinks, false);
	window.addEventListener('load', cleanlinks, false);
})();
