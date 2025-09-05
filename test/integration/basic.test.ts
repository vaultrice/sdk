import { describe, it, expect, beforeAll } from 'vitest'
import { NonLocalStorage } from '../../src/index'
import Base from '../../src/Base'

describe(`NonLocalStorage (${process.env.MODE})`, () => {
  const basePath = process.env.BASE_PATH as string
  const apiKey = process.env.API_KEY as string
  const apiSecret = process.env.API_SECRET as string
  const projectId = process.env.PROJECT_ID as string
  const className = process.env.CLASS_NAME as string

  beforeAll(() => {
    // @ts-ignore
    Base.basePath = basePath
  })

  describe('basic usage', () => {
    it('should work as expected', async () => {
      const nls = new NonLocalStorage({ apiKey, apiSecret, projectId }, { class: className })

      let item = await nls.getItem('my-prop')
      expect(item).to.eql(undefined)

      const setInfo = await nls.setItem('my-prop', 'my-value')
      expect(setInfo).to.have.property('expiresAt')
      expect(setInfo).to.have.property('createdAt')
      expect(setInfo).to.have.property('updatedAt')

      item = await nls.getItem('my-prop')
      expect(item).not.to.eql(undefined)
      expect(item).to.have.property('value', 'my-value')
      expect(item).to.have.property('expiresAt')
      expect(item).to.have.property('createdAt')
      expect(item).to.have.property('updatedAt')

      item = await nls.getItem<string>('my-prop')
      expect(item).not.to.eql(undefined)
      expect(item).to.have.property('value', 'my-value')
      expect(item).to.have.property('expiresAt')
      expect(item).to.have.property('createdAt')
      expect(item).to.have.property('updatedAt')

      await nls.setItem('my-prop-2', 'my-value-2')
      await nls.setItem('my-prop-3', 'my-value-3')
      item = await nls.getItem('my-prop-3')
      expect(item).not.to.eql(undefined)

      const items = await nls.getItems(['my-prop-2', 'my-prop-3'])
      expect(items).to.have.property('my-prop-2')
      expect(items).to.have.property('my-prop-3')
      expect(items?.['my-prop-2']).to.have.property('value', 'my-value-2')
      expect(items?.['my-prop-2']).to.have.property('expiresAt')
      expect(items?.['my-prop-2']).to.have.property('createdAt')
      expect(items?.['my-prop-2']).to.have.property('updatedAt')

      await nls.removeItem('my-prop-3')
      item = await nls.getItem('my-prop-3')
      expect(item).to.eql(undefined)

      const setInfos = await nls.setItems({ another: { value: 'here' } })
      expect(setInfos).to.have.property('another')
      expect(setInfos?.another).to.have.property('value', 'here')
      expect(setInfos?.another).to.have.property('expiresAt')
      expect(setInfos?.another).to.have.property('createdAt')
      expect(setInfos?.another).to.have.property('updatedAt')

      item = await nls.getItem('another')
      expect(item?.value).to.eql('here')

      await nls.removeItems(['another'])
      item = await nls.getItem('another')
      expect(item).to.eql(undefined)

      const allItems = await nls.getAllItems()
      expect(allItems).to.have.property('my-prop')
      expect(allItems).to.have.property('my-prop-2')
      expect(allItems?.['my-prop-2']).to.have.property('value', 'my-value-2')
      expect(allItems?.['my-prop-2']).to.have.property('expiresAt')
      expect(allItems?.['my-prop-2']).to.have.property('createdAt')
      expect(allItems?.['my-prop-2']).to.have.property('updatedAt')

      const keys = await nls.getAllKeys()
      expect(keys).to.contain('my-prop')
      expect(keys).to.contain('my-prop-2')

      const incr = await nls.incrementItem('counter')
      expect(incr).to.have.property('value', 1)
      expect(incr).to.have.property('expiresAt')
      expect(incr).to.have.property('createdAt')
      expect(incr).to.have.property('updatedAt')
      const decr = await nls.decrementItem('counter', 4)
      expect(decr).to.have.property('value', -3)
      expect(decr).to.have.property('expiresAt')
      expect(decr).to.have.property('createdAt')
      expect(decr).to.have.property('updatedAt')

      await nls.push('my-array', 'first')
      let arrItem = await nls.getItem('my-array')
      expect(arrItem).not.to.eql(undefined)
      expect(arrItem?.value).to.eql(['first'])

      await nls.push('my-array', 'second')
      arrItem = await nls.getItem('my-array')
      expect(arrItem?.value).to.eql(['first', 'second'])

      await nls.setItem('my-obj', { a: 1, b: 2 })
      await nls.merge('my-obj', { b: 3, c: 4 })
      const merged = await nls.getItem('my-obj')
      expect(merged?.value).to.eql({ a: 1, b: 3, c: 4 })

      await nls.setItem('my-nested', { user: { profile: { name: 'old' } } })
      await nls.setIn('my-nested', 'user.profile.name', 'Alice')
      const nested = await nls.getItem<{ user: { profile: { name: string } } }>('my-nested')
      expect(nested?.value?.user?.profile?.name).to.eql('Alice')

      await nls.clear()
      item = await nls.getItem('my-prop-2')
      expect(item).to.eql(undefined)
    })
  })
})
