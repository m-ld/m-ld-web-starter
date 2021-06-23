const { clone, shortId, uuid, asSubjectUpdates } = require('@m-ld/m-ld');
const { IoRemotes } = require('@m-ld/m-ld/dist/socket.io');
const MemDown = require('memdown');

/**
 * Manages display of the form content by manipulating the DOM in response to events in the local
 * **m-ld** clone.
 */
class FormController {
  constructor() {
    // Get the form ID from the page URL
    const formId = /** @type {string} */
      window.location.pathname.split('/').slice(-1)[0];
    getElement('form-name').textContent = formId;
    getElement('add-party').disabled = true;
    getElement('add-item').disabled = true;
    const itemTableBody = getElement('items', 'tbody');

    // The clone method initialises the m-ld engine and resolves a clone (hereafter called 'meld')
    clone(new MemDown, IoRemotes, {
      // Unique clone identifier
      '@id': uuid(),
      // The m-ld domain name (must conform to an IETF domain name)
      '@domain': `${formId}.web-starter.m-ld.org`,
      // The 'genesis' is given to us via the server, and indicates whether this domain is brand-new
      genesis: getCookie('is-genesis') === 'true',
      // Change this flag to reduce console logging by m-ld
      logLevel: 'debug'
    }).then(async meld => {
      // We call the clone 'meld'
      this.meld = meld;
      // Wait for the clone to be fully up-to-date.
      await meld.status.becomes({ outdated: false });
      // Read the latest data from m-ld and populate the form.
      meld.read(
        // The read method holds the clone state constant until the first callback resolves, so we
        // can be sure nothing is changing. The second callback is called for every update
        // afterwards.
        async state => {
          // Each 'party' is a stand-alone subject in the domain. Just describe every subject marked
          // as the 'party' type.
          const parties = await state.read({
            '@describe': '?id',
            '@where': { '@id': '?id', '@type': 'party' }
          });
          parties.forEach(party => this.appendPartyElement(party));
          // The 'items' are stored as a list, which has the fixed identity 'items'. Using
          // construct, which does a pattern match, we can retrieve not only the identities of the
          // items but also their contents.
          const itemsList = await state.read({
            '@construct': {
              '@id': 'items',
              // This says: retrieve every list index ('?' denotes a variable), and for the item in
              // each index give me every property and value (the variable names are just for
              // readability, they could all just be '?')
              '@list': { '?index': { '@id': '?itemId', '?prop': '?value' } }
            }
          });
          itemsList[0]?.['@list'].forEach(item => {
            const itemElement = itemTableBody.appendChild(this.createItemElement(item['@id']));
            this.updateItemElement(item, itemElement);
          });
          // Ready for user input!
          getElement('add-party').disabled = false;
          getElement('add-item').disabled = false;
        },
        // For every update, the state is held constant while we process it, until
        // the returned promise resolves.
        async (update, state) => {
          // There are many possible ways to handle updates. Here, we generally ignore the
          // fine-grained update information and just load the current state of the affected
          // subject (party or item). First we re-arrange the update to be indexed by subject ID.
          await Promise.all(Object.entries(asSubjectUpdates(update)).map(async ([id, subjectUpdate]) => {
            // Do we already have an element for the updated subject?
            const element = getElement(id);
            if (element?.classList.contains('party')) {
              // If the subject is a party for which we already have an element, describe the
              // current party in full and update the element.
              const party = await this.describe(state, id);
              if (party != null)
                this.updatePartyElement(party, element);
              else
                element.remove();
            } else if (subjectUpdate['@insert']?.['@type'] === 'party') {
              // If the update is a brand-new party we haven't seen before, we don't need to load
              // the current state as it's all in the update itself.
              this.appendPartyElement(subjectUpdate['@insert']);
            } else if (element?.classList.contains('item')) {
              // If the subject is an item for which we already have an element, describe the
              // current item in full and update the element.
              const item = await this.describe(state, id);
              if (item != null)
                this.updateItemElement(item, element);
            } else if (id === 'items') {
              // If the items list content has changed, describe the items list in full. Note that
              // using describe will only load the item references, not all the contents. That's
              // fine because we probably already have some of the item content, and we can be more
              // surgical about what state to ask m-ld for.
              const itemRefs = (await this.describe(state, 'items'))?.['@list'] ?? [];
              // Items will appear in-order after the hidden item HTML template
              let prev = getElement('item-template'), toLoad = [];
              for (let { '@id': id } of itemRefs) {
                // If we don't already have the item content in an element, we'll need to load it.
                // For now just create a placeholder element.
                const element = getElement(id) ?? (toLoad.push(id) && this.createItemElement(id));
                prev.insertAdjacentElement('afterend', element);
                prev = element;
              }
              // After going through all the current items, if there are any elements left over
              // these must have been removed from the form and we can safely delete them.
              while (prev.nextElementSibling)
                prev.nextElementSibling.remove();
              // Finally, load every item we hadn't seen already in full
              await Promise.all(toLoad.map(async id => {
                this.updateItemElement(await this.describe(state, id), getElement(id));
              }));
            }
          }));
        });

      // When the Add buttons are clicked, write a new party or item to m-ld. Note that we don't
      // immediately add the HTML, since we'll be notified of our own update and we do it then,
      // just the same as if another clone had added the new content.
      getElement('add-party').addEventListener('click', () => {
        meld.write({ '@id': shortId(), '@type': 'party', name: 'enter party name' })
          .catch(this.showError);
      });
      getElement('add-item').addEventListener('click', () => {
        meld.write({
          '@id': 'items',
          '@list': {
            // We want to append to the list, so the insert index is the child element count
            [getElement('items', 'tbody').childElementCount]:
              { '@id': shortId(), '@type': 'item', quantity: 1 }
          }
        }).catch(this.showError);
      });
    }).catch(this.showError);
  }

  /**
   * Shorthand for retrieving the properties of some subject from the m-ld clone as a Javascript
   * object
   * @param state the m-ld state being read from
   * @param id the identity of the subject
   * @returns {Promise<object|undefined>}
   */
  async describe(state, id) {
    return (await state.read({ '@describe': id }))[0];
  }

  /**
   * Add a new Party HTML element to the page and initialise it with the given properties
   * @param party {object} the subject
   */
  appendPartyElement(party) {
    const element = this.createSubjectElement(party['@id'], 'party');
    this.addPropertyInputListener(element, 'party', 'name');
    getElement(element, '.party-delete').addEventListener(
      'click', () => this.meld.write({ '@delete': { '@id': party['@id'] } }).catch(this.showError));
    this.updatePartyElement(party, element);
    getElement('parties').appendChild(element);
    getElement(element, '.party-name').select();
  }

  /**
   * Update a party HTML element with the current properties from the app state
   * @param party {object} the subject
   * @param element {HTMLElement} the party HTML element
   */
  updatePartyElement(party, element) {
    this.updatePropertyInput(element, 'party', party, 'name');
  }

  /**
   * Add a new Item HTML table row to the page (it must be initialised with properties separately)
   * @param id {object} the Item identity
   */
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

  /**
   * Shorthand to get the Item HTML elements, excluding the template row
   * @returns {HTMLElement[]} an array of Item HTML table rows
   */
  get itemNodes() {
    // Note item template is at position 0
    return [].slice.call(getElement('items', 'tbody').children, 1);
  }

  /**
   * Shorthand for moving an item in the items list
   * @param id the identity of the item to move
   * @param oldIndex the index of the element prior to moving it
   * @param newIndex the new index of the element. Note that this new index is relative to the
   *   original list (not to the modified list).
   */
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

  /**
   * Update an Item HTML table row with the current properties from the app state
   * @param item {object} the subject
   * @param element {HTMLElement} Item HTML table row to update
   */
  updateItemElement(item, element) {
    this.updatePropertyInput(element, 'item', item,
      'product', 'quantity', 'stock', 'price');
  }

  /**
   * Generic method to clone some HTML from a template and set it up to be populated with data
   * @param id the identity of the Subject whose data will occupy the returned element
   * @param clazz the type of the Subject
   * @returns {HTMLElement} the created (unpopulated) HTML element
   */
  createSubjectElement(id, clazz) {
    const element = /** @type {HTMLElement} */
      getElement(`${clazz}-template`).cloneNode(true);
    element.classList.add(clazz);
    element.hidden = false;
    element.id = id;
    return element;
  }

  /**
   * Generic method to set up input listeners on the sub-element HTMLInputElements of the given
   * element, which push the changes to the local clone.
   * @param element the parent element corresponding to the Subject
   * @param clazz the type of the Subject
   * @param properties property names, each of which must have a corresponding input
   */
  addPropertyInputListener(element, clazz, ...properties) {
    for (let property of properties) {
      const input = /**@type {HTMLInputElement}*/getElement(element, `.${clazz}-${property}`);
      input.addEventListener('input', () => {
        this.meld.write(async state => {
          const selectOld = await state.read({
            '@select': '?old',
            '@where': { '@id': element.id, [property]: '?old' }
          });
          const oldValue = selectOld[0]?.['?old'];
          const newValue = input.type === 'number' ? Number(input.value) : input.value;
          if (oldValue != null) {
            await state.write({
              '@delete': { '@id': element.id, [property]: oldValue },
              '@insert': { '@id': element.id, [property]: newValue }
            });
          } else {
            await state.write({ '@id': element.id, [property]: newValue });
          }
        }).catch(this.showError);
        // Also hide any previous message when the user acts
        this.hideMessage();
      });
    }
  }

  /**
   * Update input elements, descendants of the given parent element, with property values from the
   * given Subject.
   * @param element the parent element corresponding to the Subject
   * @param clazz the type of the Subject
   * @param subject the Subject instance
   * @param properties property names, each of which must have a corresponding input
   */
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
      case 5031:
        return this.showMessage(
          '⚠️ This form exists but no-one is around to load it from.', 'olive');
      default:
        return this.showMessage(`❌ ${err}`, 'red');
    }
  };
}

/**
 * Shorthand to get a page Element reference
 * @param id {HTMLElement|string} the Element to start with, or its `id`
 * @param [subSelector] {string|undefined} a selector for a descendant of the identified Element
 * @returns {HTMLElement} the identified element or one of its descendants
 */
function getElement(id, subSelector) {
  const element = id instanceof HTMLElement ? id : document.getElementById(id);
  return subSelector == null ? element : element.querySelector(subSelector);
}

/**
 * Gets a cookie value with a given name
 * @param name the cookie name
 * @returns {string} the cookie value
 */
function getCookie(name) {
  return document.cookie.match(`(?:^|;) ?${name}=([^;]*)(?:;|$)`)[1];
}

/**
 * Create the controller for the form page, and register an unload listener which checks if the
 * local clone is a 'silo' (it is the last clone in the domain), and warns the user if so.
 */
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