const { clone, shortId, uuid, asSubjectUpdates } = require('@m-ld/m-ld');
const { IoRemotes } = require('@m-ld/m-ld/dist/socket.io');
const MemDown = require('memdown');

class FormController {
  constructor() {
    const formId = /** @type {string} */
      window.location.pathname.split('/').slice(-1)[0];
    getElement('form-name').textContent = formId;
    getElement('add-party').disabled = true;
    getElement('add-item').disabled = true;
    const itemTableBody = getElement('items', 'tbody');
    clone(new MemDown, IoRemotes, {
      '@id': uuid(),
      '@domain': `${formId}.web-starter.m-ld.org`,
      genesis: getCookie('is-genesis') === 'true',
      logLevel: 'debug'
    }).then(async meld => {
      this.meld = meld;
      await meld.status.becomes({ outdated: false });
      // Get the latest data and populate the form
      meld.read(async state => {
        (await state.read({
          '@describe': '?id',
          '@where': { '@id': '?id', '@type': 'party' }
        })).forEach(party => this.appendPartyElement(party));
        (await state.read({
          '@construct': { '@id': 'items', '@list': { '?': { '@id': '?', '?': '?' } } }
        }))[0]?.['@list'].forEach(item => this.updateItemElement(item, itemTableBody
          .appendChild(this.createItemElement(item['@id']))));
        // Good to go!
        getElement('add-party').disabled = false;
        getElement('add-item').disabled = false;
      }, async (update, state) => {
        await Promise.all(Object.entries(asSubjectUpdates(update)).map(async ([id, subjectUpdate]) => {
          const element = getElement(id);
          if (element?.classList.contains('party')) {
            const party = await this.describe(state, id);
            if (party != null)
              this.updatePartyElement(party, element);
            else
              element.remove();
          } else if (subjectUpdate['@insert']?.['@type'] === 'party') {
            this.appendPartyElement(subjectUpdate['@insert']);
          } else if (element?.classList.contains('item')) {
            const item = await this.describe(state, id);
            if (item != null)
              this.updateItemElement(item, element);
          } else if (id === 'items') {
            // Load the list (just item references) and sync
            const itemRefs = (await this.describe(state, 'items'))?.['@list'] ?? [];
            let prev = getElement('item-template'), toLoad = [];
            for (let { '@id': id } of itemRefs) {
              const element = getElement(id) ?? (toLoad.push(id) && this.createItemElement(id));
              prev.insertAdjacentElement('afterend', element);
              prev = element;
            }
            while (prev.nextElementSibling)
              prev.nextElementSibling.remove();
            await Promise.all(toLoad.map(async id => {
              this.updateItemElement(await this.describe(state, id), getElement(id));
            }));
          }
        }));
      });

      getElement('add-party').addEventListener('click', () => {
        meld.write({ '@id': shortId(), '@type': 'party', name: 'enter party name' })
          .catch(this.showError);
      });
      getElement('add-item').addEventListener('click', () => {
        meld.write({
          '@id': 'items',
          '@list': {
            [getElement('items', 'tbody').childElementCount]:
              { '@id': shortId(), '@type': 'item', qty: 1 }
          }
        }).catch(this.showError);
      });
    }).catch(this.showError);
  }

  async describe(state, id) {
    return (await state.read({ '@describe': id }))[0];
  }

  appendPartyElement(party) {
    const element = this.createSubjectElement(party['@id'], 'party');
    this.addPropertyInputListener(element, 'party', 'name');
    getElement(element, '.party-delete').addEventListener(
      'click', () => this.meld.write({ '@delete': { '@id': party['@id'] } }).catch(this.showError));
    this.updatePartyElement(party, element);
    getElement('parties').appendChild(element);
    getElement(element, '.party-name').select();
  }

  updatePartyElement(party, element) {
    this.updatePropertyInput(element, 'party', party, 'name');
  }

  createItemElement(id) {
    const element = this.createSubjectElement(id, 'item');
    this.addPropertyInputListener(element, 'item', 'product', 'quantity', 'stock', 'price');
    getElement(element, '.item-delete').addEventListener('click', () => {
      this.meld.write({
        '@delete': { '@id': 'items', '@list': { '?': { '@id': id, '?': '?' } } }
      }).catch(this.showError);
    });
    getElement(element, '.item-up').addEventListener('click', () => {
      const index = this.itemNodes.indexOf(element);
      if (index > 0)
        this.writeMoveItem(id, index, index - 1);
    });
    getElement(element, '.item-down').addEventListener('click', () => {
      const index = this.itemNodes.indexOf(element);
      if (index < this.itemNodes.length - 1)
        this.writeMoveItem(id, index, index + 2);
    });
    return element;
  }

  get itemNodes() {
    // Note item template is at position 0
    return [].slice.call(getElement('items', 'tbody').children, 1);
  }

  writeMoveItem(id, oldIndex, newIndex) {
    this.meld.write({
      '@delete': {
        '@id': 'items',
        '@list': { [oldIndex]: { '@id': '?slot', '@item': { '@id': id } } }
      },
      '@insert': {
        '@id': 'items',
        '@list': { [newIndex]: { '@id': '?slot', '@item': { '@id': id } } }
      }
    }).catch(this.showError);
  }

  updateItemElement(item, element) {
    this.updatePropertyInput(element, 'item', item,
      'product', 'quantity', 'stock', 'price');
  }

  createSubjectElement(id, clazz) {
    const element = /** @type {HTMLElement} */
      getElement(`${clazz}-template`).cloneNode(true);
    element.classList.add(clazz);
    element.hidden = false;
    element.id = id;
    return element;
  }

  addPropertyInputListener(element, clazz, ...properties) {
    for (let property of properties) {
      const input = getElement(element, `.${clazz}-${property}`);
      input.addEventListener('input', () => {
        this.meld.write(async state => {
          const selectOld = await state.read({
            '@select': '?old',
            '@where': { '@id': element.id, [property]: '?old' }
          });
          const old = selectOld[0]?.['?old'];
          if (old != null) {
            await state.write({
              '@delete': { '@id': element.id, [property]: old },
              '@insert': { '@id': element.id, [property]: input.value }
            });
          } else {
            await state.write({ '@id': element.id, [property]: input.value });
          }
        }).catch(this.showError);
        // Also hide any previous message when the user acts
        this.hideMessage();
      });
    }
  }

  updatePropertyInput(element, clazz, subject, ...properties) {
    for (let property of properties) {
      const input = getElement(element, `.${clazz}-${property}`);
      let value = subject[property];
      if (Array.isArray(value)) {
        this.showMessage('⚠️ Someone else is editing this value!', 'olive');
        // Show the conflicting value, not mine
        value = value.filter(v => v !== value)[0];
      }
      input.value = value ?? '';
    }
  }

  showMessage(msg, color) {
    const msgNode = getElement('message');
    if (color)
      msgNode.setAttribute('style', `color: ${color}`);
    msgNode.hidden = false;
    msgNode.textContent = msg;
  }

  hideMessage() {
    getElement('message').hidden = true;
  }

  showError = err => {
    switch (err.status) {
      case 5031: return this.showMessage(
        '⚠️ This form exists but no-one is around to load it from.', 'olive');
      default:
        return this.showMessage(`❌ ${err}`, 'red');
    }
  };
}

function getElement(id, subSelector) {
  const element = id instanceof HTMLElement ? id : document.getElementById(id);
  return subSelector == null ? element : element.querySelector(subSelector);
}

function getCookie(name) {
  return document.cookie.match(`(?:^|;) ?${name}=([^;]*)(?:;|$)`)[1];
}

window.onload = () => {
  const form = new FormController();
  window.addEventListener('beforeunload', e => {
    if (form.meld?.status.value.silo) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.onunload = () => form.meld?.close();
};