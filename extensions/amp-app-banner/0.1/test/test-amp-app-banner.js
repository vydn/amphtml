/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {createIframePromise} from '../../../../testing/iframe';
import {platformFor} from '../../../../src/services';
import {vsyncFor} from '../../../../src/services';
import {
    AmpAppBanner,
    AbstractAppBanner,
    AmpIosAppBanner,
    AmpAndroidAppBanner,
} from '../amp-app-banner';
import {xhrFor} from '../../../../src/services';
import '../../../amp-analytics/0.1/amp-analytics';
import * as sinon from 'sinon';
import {AmpDocSingle} from '../../../../src/service/ampdoc-impl';
import {viewerForDoc} from '../../../../src/services';

describe('amp-app-banner', () => {

  let sandbox;
  let vsync;
  let platform;
  let isAndroid = false;
  let isIos = false;
  let isChrome = false;
  let isSafari = false;
  let isEmbedded = false;

  const meta = {
    content: 'app-id=828256236, app-argument=medium://p/cb7f223fad86',
  };
  const manifest = {
    href: 'https://example.com/manifest.json',
    content: {
      'prefer_related_applications': true,
      'related_applications': [
        {
          'platform': 'play',
          'id': 'com.medium.reader',
          'url': 'https://play.google.com/com.medium.reader',
        },
      ],
    },
  };

  function runTask(task, state) {
    if (task.measure) {
      task.measure(state);
    }
    if (task.mutate) {
      task.mutate(state);
    }
  }

  function getTestFrame() {
    return createIframePromise(true).then(iframe => {
      const ampdoc = new AmpDocSingle(iframe.win);
      const viewer = viewerForDoc(ampdoc);
      sandbox.stub(viewer, 'isEmbedded', () => isEmbedded);
      platform = platformFor(iframe.win);
      sandbox.stub(platform, 'isIos', () => isIos);
      sandbox.stub(platform, 'isAndroid', () => isAndroid);
      sandbox.stub(platform, 'isChrome', () => isChrome);
      sandbox.stub(platform, 'isSafari', () => isSafari);

      vsync = vsyncFor(iframe.win);
      sandbox.stub(vsync, 'runPromise', (task, state) => {
        runTask(task, state);
        return Promise.resolve();
      });
      sandbox.stub(vsync, 'run', runTask);
      return iframe;
    });
  }

  function getAppBanner(config = {}) {
    return getTestFrame().then(iframe => {
      const link = iframe.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      link.setAttribute('href', 'https://example.com/amps.html');
      iframe.doc.head.appendChild(link);

      if (config.meta) {
        const meta = iframe.doc.createElement('meta');
        meta.setAttribute('name', 'apple-itunes-app');
        meta.setAttribute('content', config.meta.content);
        iframe.doc.head.appendChild(meta);
      }

      const manifestObj = config.originManifest || config.manifest;
      if (manifestObj) {
        const rel = config.originManifest ? 'origin-manifest' : 'manifest';
        const manifest = iframe.doc.createElement('link');
        manifest.setAttribute('rel', rel);
        manifest.setAttribute('href', manifestObj.href);
        iframe.doc.head.appendChild(manifest);
        sandbox.mock(xhrFor(iframe.win)).expects('fetchJson')
            .returns(Promise.resolve(manifestObj.content));
      }

      const banner = iframe.doc.createElement('amp-app-banner');
      banner.setAttribute('layout', 'nodisplay');
      banner.getAmpDoc = () => iframe.ampdoc;
      if (!config.noOpenButton) {
        const openButton = iframe.doc.createElement('button');
        openButton.setAttribute('open-button', '');
        banner.appendChild(openButton);
      }

      return iframe.addElement(banner);
    });
  }

  function testButtonMissing() {
    return getAppBanner({
      meta,
      manifest,
      noOpenButton: true,
    }).should.eventually.be.rejectedWith(/<button open-button> is required/);
  }

  function testAddDismissButton() {
    sandbox.stub(AbstractAppBanner.prototype, 'isDismissed', () => {
      return Promise.resolve(false);
    });
    sandbox.spy(AbstractAppBanner.prototype, 'addDismissButton_');
    sandbox.spy(AbstractAppBanner.prototype, 'updateViewportPadding_');
    return getAppBanner({meta, manifest}).then(banner => {
      expect(banner.parentElement).to.not.be.null;
      expect(AbstractAppBanner.prototype.addDismissButton_.called).to.be.true;
      expect(AbstractAppBanner.prototype.updateViewportPadding_.called)
          .to.be.true;
      expect(banner.style.display).to.be.equal('');
      expect(banner.style.visibility).to.be.equal('');
    });
  }

  function testRemoveIfDismissed() {
    sandbox.stub(AbstractAppBanner.prototype, 'isDismissed', () => {
      return Promise.resolve(true);
    });
    return getAppBanner().then(banner => {
      expect(banner.parentElement).to.be.null;
      expect(banner.style.display).to.be.equal('');
      expect(banner.style.visibility).to.be.equal('hidden');
    });
  }

  function testManifestPreconnectPreload(rel) {
    const config = {};
    config[rel] = manifest;
    return () => {
      return getAppBanner(config).then(banner => {
        const impl = banner.implementation_;
        sandbox.stub(impl.preconnect, 'url');
        sandbox.stub(impl.preconnect, 'preload');
        impl.preconnectCallback(true);
        expect(impl.preconnect.url.called).to.be.true;
        expect(impl.preconnect.url).to.have.been.calledOnce;
        expect(impl.preconnect.url)
            .to.have.been.calledWith('https://play.google.com');
        expect(impl.preconnect.preload.called).to.be.true;
        expect(impl.preconnect.preload).to.be.calledOnce;
        expect(impl.preconnect.preload).to.have.been.calledWith(
            'https://example.com/manifest.json');
      });
    };
  }

  function testManifestParseAndHrefs(rel) {
    const config = {};
    config[rel] = manifest;
    return () => {
      sandbox.spy(AbstractAppBanner.prototype, 'setupOpenButton_');
      return getAppBanner({manifest}).then(el => {
        expect(AbstractAppBanner.prototype.setupOpenButton_)
            .to.have.been.calledWith(
              el.querySelector('button[open-button]'),
              'android-app://com.medium.reader/https/example.com/amps.html',
              'https://play.google.com/store/apps/details?id=com.medium.reader'
        );
      });
    };
  }

  beforeEach(() => {
    sandbox = sinon.sandbox.create();
    platform = platformFor(window);
    sandbox.stub(platform, 'isIos', () => isIos);
    sandbox.stub(platform, 'isAndroid', () => isAndroid);
    sandbox.stub(platform, 'isChrome', () => isChrome);
    sandbox.stub(platform, 'isSafari', () => isSafari);
    isAndroid = false;
    isIos = false;
    isChrome = false;
    isSafari = false;
    isEmbedded = false;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Choosing platform', () => {
    it('should upgrade to AmpIosAppBanner on iOS', () => {
      isIos = true;
      return getAppBanner({meta, manifest}).then(banner => {
        expect(banner.implementation_).to.be.instanceof(AmpIosAppBanner);
      });
    });

    it('should upgrade to AmpAndroidAppBanner on Android', () => {
      isAndroid = true;
      return getAppBanner({meta, manifest}).then(banner => {
        expect(banner.implementation_).to.be.instanceof(AmpAndroidAppBanner);
      });
    });

    it('should not upgrade if platform not supported', () => {
      return getAppBanner({meta, manifest}).then(banner => {
        expect(banner.implementation_).to.be.instanceof(AmpAppBanner);
        expect(banner.implementation_.upgradeCallback()).to.be.null;
      });
    });
  });

  describe('non-supported platform', () => {
    it('should remove the banner', () => {
      return getAppBanner().then(banner => {
        expect(banner.parentElement).to.be.null;
      });
    });
  });

  describe('iOS', () => {
    beforeEach(() => {
      isIos = true;
    });

    it('should preconnect to app store', () => {
      return getAppBanner().then(banner => {
        // Re-add to DOM so that we can call `preconnectCallback`.
        banner.ownerDocument.body.appendChild(banner);
        const impl = banner.implementation_;
        sandbox.stub(impl.preconnect, 'url');
        impl.preconnectCallback(true);
        expect(impl.preconnect.url.called).to.be.true;
        expect(impl.preconnect.url).to.be.calledOnce;
        expect(impl.preconnect.url)
            .to.have.been.calledWith('https://itunes.apple.com');
      });
    });

    it('should throw if open button is missing', testButtonMissing);

    it('should remove banner if meta is not provided', () => {
      return getAppBanner({meta: null}).then(banner => {
        expect(banner.parentElement).to.be.null;
      });
    });

    it('should remove banner if safari and not embedded', () => {
      isSafari = true;
      isEmbedded = false;
      return getAppBanner().then(banner => {
        expect(banner.parentElement).to.be.null;
      });
    });

    it('should show banner if safari and embedded', () => {
      isSafari = true;
      isEmbedded = true;
      return getAppBanner({meta}).then(banner => {
        expect(banner.parentElement).to.not.be.null;
      });
    });

    it('should add dismiss button and update padding', testAddDismissButton);

    it('should remove banner if already dismissed', testRemoveIfDismissed);

    it('should parse meta content and setup hrefs', () => {
      sandbox.spy(AbstractAppBanner.prototype, 'setupOpenButton_');
      return getAppBanner({meta}).then(el => {
        expect(AbstractAppBanner.prototype.setupOpenButton_)
            .to.have.been.calledWith(
                el.querySelector('button[open-button]'),
                'medium://p/cb7f223fad86',
                'https://itunes.apple.com/us/app/id828256236');
      });
    });

    it('should parse meta content and validate app-argument url', () => {
      return getAppBanner({
        meta: {content:
            'app-id=828256236, app-argument=javascript:alert("foo");'},
      }).should.eventually.be.rejectedWith(
         /The url in app-argument is invalid/);
    });
  });

  describe('Android', () => {
    beforeEach(() => {
      isAndroid = true;
      isChrome = false;
    });

    it('should preconnect to play store and preload manifest',
        testManifestPreconnectPreload('manifest'));
    it('should preconnect to play store and preload origin-manifest',
        testManifestPreconnectPreload('originManifest'));

    it('should throw if open button is missing', testButtonMissing);
    it('should add dismiss button and update padding', testAddDismissButton);
    it('should remove banner if already dismissed', testRemoveIfDismissed);

    it('should remove banner if manifest is not provided', () => {
      return getAppBanner({manifest: null}).then(banner => {
        expect(banner.parentElement).to.be.null;
      });
    });

    it('should remove banner if origin-manifest is not provided', () => {
      return getAppBanner({originManifest: null}).then(banner => {
        expect(banner.parentElement).to.be.null;
      });
    });

    it('should remove banner if chrome', () => {
      isChrome = true;
      return getAppBanner().then(banner => {
        expect(banner.parentElement).to.be.null;
      });
    });

    it('should parse manifest and set hrefs',
        testManifestParseAndHrefs('manifest'));
    it('should parse manifest and set hrefs',
        testManifestParseAndHrefs('originManifest'));
  });

  describe('Abstract App Banner', () => {
    it('should setup click listener', () => {
      return createIframePromise(true).then(iframe => {
        const doc = iframe.doc;
        const element = doc.createElement('div');
        doc.body.appendChild(element);
        const openButton = doc.createElement('button');
        element.appendChild(openButton);
        openButton.setAttribute('open-button', '');
        openButton.addEventListener = sandbox.spy();
        const banner = new AbstractAppBanner(element);
        banner.setupOpenButton_(openButton, 'open-button', 'install-link');
        expect(openButton.addEventListener).to.have.been.calledWith('click');
      });
    });

    it('should create dismiss button and setup click listener', () => {
      return createIframePromise(true).then(iframe => {
        const win = iframe.win;
        const doc = iframe.doc;
        vsync = vsyncFor(win);
        sandbox.stub(vsync, 'run', runTask);
        const element = doc.createElement('div');
        element.id = 'banner1';
        element.getAmpDoc = () => iframe.ampdoc;
        doc.body.appendChild(element);
        const banner = new AbstractAppBanner(element);
        banner.addDismissButton_();

        const bannerTop = element.querySelector(
            'i-amphtml-app-banner-top-padding');
        expect(bannerTop).to.exist;
        const dismissBtn = element.querySelector(
            '.amp-app-banner-dismiss-button');
        expect(dismissBtn).to.not.be.null;
        expect(dismissBtn.parentElement).to.be.equal(element);
        dismissBtn.dispatchEvent(new Event('click'));
        expect(element.parentElement).to.be.null;
        return banner.isDismissed().then(value => {
          expect(value).to.be.true;
        });
      });
    });
  });
});
