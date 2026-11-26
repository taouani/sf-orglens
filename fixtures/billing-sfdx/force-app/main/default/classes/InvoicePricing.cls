/**
 * How an invoice is priced. A subclass decides the price of an invoice, and may change the discount of an account.
 */
public abstract with sharing class InvoicePricing {
    public abstract Decimal price(Invoice__c invoice);

    public virtual Decimal price(Invoice_Line__c line) {
        return line.Quantity__c * line.Unit_Price__c;
    }

    public virtual Decimal discount(Account account) {
        return account.Tier__c == 'Gold' ? 0.1 : 0;
    }

    public Decimal round(Decimal amount) {
        return amount.setScale(2);
    }

    public Decimal round(Integer amount) {
        return Decimal.valueOf(amount);
    }
}
